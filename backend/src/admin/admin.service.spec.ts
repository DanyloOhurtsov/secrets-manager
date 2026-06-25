import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../auth/authorization.service';
import { CacheService } from '../cache/cache.service';
import { AuthPrincipal } from '../auth/auth.types';

const actor: AuthPrincipal = {
  id: 'actor-1',
  name: 'Actor',
  email: 'actor@example.com',
  type: 'human',
  isSuperadmin: false,
  serviceOrganizationId: null,
  authMethod: 'session',
};

// Один рядок гранту в нашій псевдо-БД для actor-а.
interface GrantRow {
  projectId: string;
  role: string;
  canManageGrants: boolean;
}

describe('AdminService — tenant audit scope', () => {
  let service: AdminService;
  let prisma: {
    organizationMembership: { findMany: jest.Mock };
    grant: { findMany: jest.Mock };
    auditLog: { findMany: jest.Mock };
  };
  let auditLogWhere: jest.Mock;

  // Емулює фільтрацію grant.findMany на боці БД: повертає лише ті рядки, що
  // справді матчаться переданим where. Так тест ловить регрес: якщо сервіс знову
  // почне враховувати { canManageGrants: true }, легасі-грант "пройде" і тест впаде.
  function mockGrantsDb(rows: GrantRow[]) {
    prisma.grant.findMany.mockImplementation(
      (args: { where: Record<string, any> }) => {
        const where = args.where;
        const matched = rows.filter((g) => {
          if (where.role !== undefined) return g.role === where.role;
          if (Array.isArray(where.OR)) {
            return where.OR.some(
              (cond: Record<string, any>) =>
                (cond.role !== undefined && g.role === cond.role) ||
                (cond.canManageGrants !== undefined &&
                  g.canManageGrants === cond.canManageGrants),
            );
          }
          return true;
        });
        return Promise.resolve(
          matched.map((g) => ({ projectId: g.projectId })),
        );
      },
    );
  }

  beforeEach(async () => {
    auditLogWhere = jest.fn();
    prisma = {
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
      grant: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        findMany: jest.fn().mockImplementation((args: { where: unknown }) => {
          auditLogWhere(args.where);
          return Promise.resolve([{ action: 'secret.create' }]);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { logRequired: jest.fn() } },
        { provide: AuthorizationService, useValue: {} },
        { provide: CacheService, useValue: {} },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // Req #6: легасі-прапорець на НЕадмінському гранті не дає доступу до аудиту.
  it('does NOT grant tenant audit access via a legacy canManageGrants:true non-admin grant', async () => {
    mockGrantsDb([
      { projectId: 'proj-legacy', role: 'developer', canManageGrants: true },
    ]);

    await expect(service.listAuditForActor(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // Доказ закриття обходу: запит грантів іде ЛИШЕ за роллю admin, без OR на
    // canManageGrants. Тож developer-грант із прапорцем не потрапляє в скоуп.
    expect(prisma.grant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identityId: 'actor-1', role: 'admin' },
      }),
    );
  });

  // Req #7: project-admin РОЛЬ гранту дає доступ до аудиту цього проєкту.
  it('grants tenant audit access through a project admin role grant', async () => {
    mockGrantsDb([
      { projectId: 'proj-1', role: 'admin', canManageGrants: false },
    ]);

    const rows = await service.listAuditForActor(actor);
    expect(rows).toEqual([{ action: 'secret.create' }]);

    expect(auditLogWhere).toHaveBeenCalledWith({
      OR: [{ projectId: { in: ['proj-1'] } }],
    });
  });

  // Req #8: org owner/admin членство й далі дає доступ до аудиту своєї org.
  it('grants tenant audit access to an org owner/admin via membership', async () => {
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org-1' },
    ]);
    mockGrantsDb([]);

    const rows = await service.listAuditForActor(actor);
    expect(rows).toEqual([{ action: 'secret.create' }]);

    expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identityId: 'actor-1', role: { in: ['owner', 'admin'] } },
      }),
    );
    expect(auditLogWhere).toHaveBeenCalledWith({
      OR: [{ organizationId: { in: ['org-1'] } }],
    });
  });
});
