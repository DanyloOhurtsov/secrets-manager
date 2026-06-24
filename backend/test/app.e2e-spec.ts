import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
      throw new Error(
        'Refusing to run e2e tests without TEST_DATABASE_URL. These tests clean the database.',
      );
    }

    const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
    if (!databaseName.includes('test')) {
      throw new Error(
        `Refusing to run e2e tests against non-test database "${databaseName}".`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.secret.updateMany({ data: { currentVersionId: null } });
    await prisma.secretVersion.deleteMany();
    await prisma.secret.deleteMany();
    await prisma.environment.deleteMany();
    await prisma.grant.deleteMany();
    await prisma.project.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.session.deleteMany();
    await prisma.token.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('isolates personal workspaces created through signup', async () => {
    const firstSignup = await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password-123',
      })
      .expect(201);

    const secondSignup = await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'password-123',
      })
      .expect(201);

    const aliceSession = firstSignup.body.sessionToken as string;
    const bobSession = secondSignup.body.sessionToken as string;
    const aliceIdentityId = firstSignup.body.identity.id as string;
    const bobIdentityId = secondSignup.body.identity.id as string;
    expect(aliceSession).toMatch(/^sess_/);
    expect(bobSession).toMatch(/^sess_/);

    const aliceLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'alice@example.com',
        password: 'password-123',
      })
      .expect(201);
    expect(aliceLogin.body.sessionToken).toMatch(/^sess_/);

    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${aliceSession}`)
      .send({ name: 'payments' })
      .expect(201);

    const projectId = projectRes.body.id as string;
    const organizationId = projectRes.body.organizationId as string;

    const envRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/environments`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .send({ name: 'production' })
      .expect(201);

    const environmentId = envRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .send({ key: 'DATABASE_URL', value: 'postgres://tenant-a' })
      .expect(201);

    const aliceProjects = await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(aliceProjects.body).toHaveLength(1);

    const bobProjects = await request(app.getHttpServer())
      .get('/projects')
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(200);
    expect(bobProjects.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(404);

    await prisma.organizationMembership.create({
      data: {
        organizationId,
        identityId: bobIdentityId,
        role: 'member',
      },
    });
    await prisma.grant.create({
      data: {
        identityId: bobIdentityId,
        projectId,
        scopeType: 'project',
        scopeId: projectId,
        role: 'developer',
      },
    });

    const bobDeveloperSecrets = await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(200);
    expect(bobDeveloperSecrets.body).toMatchObject([
      {
        key: 'DATABASE_URL',
        currentVersion: 1,
        value: null,
      },
    ]);

    await request(app.getHttpServer())
      .post(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${bobSession}`)
      .send({ key: 'REDIS_URL', value: 'redis://tenant-a' })
      .expect(403);

    const aliceAudit = await request(app.getHttpServer())
      .get(`/audit?organizationId=${organizationId}`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(
      aliceAudit.body.map((entry: { action: string }) => entry.action),
    ).toEqual(
      expect.arrayContaining([
        'auth.signup',
        'project.create',
        'environment.create',
        'secret.create',
        'secret.list',
      ]),
    );

    const secretCreateAudit = await request(app.getHttpServer())
      .get(`/audit?organizationId=${organizationId}&action=secret.create`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(secretCreateAudit.body).toHaveLength(1);

    const availableAuditActions = await request(app.getHttpServer())
      .get(`/audit/actions?organizationId=${organizationId}`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(availableAuditActions.body).toEqual(
      expect.arrayContaining(['project.create', 'secret.create']),
    );

    const multiActionAudit = await request(app.getHttpServer())
      .get(
        `/audit?organizationId=${organizationId}&action=project.create&action=secret.create`,
      )
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(
      multiActionAudit.body.map((entry: { action: string }) => entry.action),
    ).toEqual(expect.arrayContaining(['project.create', 'secret.create']));
    expect(
      multiActionAudit.body.every((entry: { action: string }) =>
        ['project.create', 'secret.create'].includes(entry.action),
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`/audit?projectId=${projectId}`)
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(403);

    // --- Reveal contract: list != reveal ---
    // 1) Без ?reveal=true повертаємо лише метадані; значення приховане (null),
    //    навіть для актора, що МАЄ право на reveal.
    const aliceListed = await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(aliceListed.body).toMatchObject([
      {
        key: 'DATABASE_URL',
        currentVersion: 1,
        // canReveal походить з її явного project admin-grant, а не з ownership.
        canReveal: true,
        value: null,
      },
    ]);

    // 2) З ?reveal=true та правом reveal повертаємо розшифроване значення.
    const aliceRevealed = await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .query({ reveal: 'true' })
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(aliceRevealed.body).toMatchObject([
      {
        key: 'DATABASE_URL',
        currentVersion: 1,
        value: 'postgres://tenant-a',
      },
    ]);

    // secret.list і secret.reveal лишаються ОКРЕМИМИ подіями аудиту.
    const revealAudit = await request(app.getHttpServer())
      .get(`/audit?organizationId=${organizationId}&action=secret.reveal`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    const revealEntries = revealAudit.body as Array<{ action: string }>;
    expect(revealEntries.length).toBeGreaterThanOrEqual(1);
    expect(
      revealEntries.every((entry) => entry.action === 'secret.reveal'),
    ).toBe(true);

    // 3) Доказ: reveal працює через ГРАНТ, а не через org ownership. Прибравши
    //    grant Alice (вона лишається owner своєї org), reveal має зникнути —
    //    значення знову null, canReveal === false.
    await prisma.grant.deleteMany({ where: { identityId: aliceIdentityId } });
    const aliceWithoutGrant = await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .query({ reveal: 'true' })
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(aliceWithoutGrant.body).toMatchObject([
      {
        key: 'DATABASE_URL',
        canReveal: false,
        value: null,
      },
    ]);
  });

  it('manages project access from the organization (members + grants)', async () => {
    const server = app.getHttpServer();
    const signup = async (name: string, email: string) => {
      const res = await request(server)
        .post('/signup')
        .send({ name, email, password: 'password-123' })
        .expect(201);
      return {
        session: res.body.sessionToken as string,
        id: res.body.identity.id as string,
      };
    };

    const alice = await signup('Alice', 'alice@example.com');
    const bob = await signup('Bob', 'bob@example.com');
    const carol = await signup('Carol', 'carol@example.com');

    // Alice заводить team-org і два проєкти в ній.
    const orgRes = await request(server)
      .post('/organizations')
      .set('Authorization', `Bearer ${alice.session}`)
      .send({ name: 'Acme' })
      .expect(201);
    const orgId = orgRes.body.id as string;

    const makeProjectWithSecret = async (name: string) => {
      const projectRes = await request(server)
        .post('/projects')
        .set('Authorization', `Bearer ${alice.session}`)
        .send({ name, organizationId: orgId })
        .expect(201);
      const projectId = projectRes.body.id as string;
      const envRes = await request(server)
        .post(`/projects/${projectId}/environments`)
        .set('Authorization', `Bearer ${alice.session}`)
        .send({ name: 'production' })
        .expect(201);
      const environmentId = envRes.body.id as string;
      await request(server)
        .post(`/environments/${environmentId}/secrets`)
        .set('Authorization', `Bearer ${alice.session}`)
        .send({ key: 'DATABASE_URL', value: `postgres://${name}` })
        .expect(201);
      return { projectId, environmentId };
    };

    const projectA = await makeProjectWithSecret('app-a');
    const projectB = await makeProjectWithSecret('app-b');

    // Add member + initial project grant (the org-centered flow).
    await request(server)
      .post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${alice.session}`)
      .send({ email: 'bob@example.com', role: 'member' })
      .expect(201);

    const grantRes = await request(server)
      .post(`/organizations/${orgId}/grants`)
      .set('Authorization', `Bearer ${alice.session}`)
      .send({
        identityId: bob.id,
        projectId: projectA.projectId,
        role: 'developer',
      })
      .expect(201);
    const grantId = grantRes.body.id as string;

    // Member отримує лише обраний проєкт: бачить метадані A, але без значень
    // (developer за замовчуванням не має reveal).
    const bobA = await request(server)
      .get(`/environments/${projectA.environmentId}/secrets`)
      .query({ reveal: 'true' })
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(200);
    expect(bobA.body).toMatchObject([
      { key: 'DATABASE_URL', canReveal: false, value: null },
    ]);

    // ...і не може створювати секрети (немає canCreate).
    await request(server)
      .post(`/environments/${projectA.environmentId}/secrets`)
      .set('Authorization', `Bearer ${bob.session}`)
      .send({ key: 'REDIS_URL', value: 'redis://nope' })
      .expect(403);

    // Member не може дотягнутися до проєкту, на який немає гранту.
    await request(server)
      .get(`/projects/${projectB.projectId}`)
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(404);
    await request(server)
      .get(`/environments/${projectB.environmentId}/secrets`)
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(404);

    // Грант "назовні" (на не-члена org) відхиляється.
    await request(server)
      .post(`/organizations/${orgId}/grants`)
      .set('Authorization', `Bearer ${alice.session}`)
      .send({
        identityId: carol.id,
        projectId: projectA.projectId,
        role: 'reader',
      })
      .expect(403);

    // Update gives Bob reveal; revoke then removes all access.
    await request(server)
      .patch(`/organizations/${orgId}/grants/${grantId}`)
      .set('Authorization', `Bearer ${alice.session}`)
      .send({ canRevealSecrets: true })
      .expect(200);
    const bobReveal = await request(server)
      .get(`/environments/${projectA.environmentId}/secrets`)
      .query({ reveal: 'true' })
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(200);
    expect(bobReveal.body).toMatchObject([
      { key: 'DATABASE_URL', value: 'postgres://app-a' },
    ]);

    await request(server)
      .delete(`/organizations/${orgId}/grants/${grantId}`)
      .set('Authorization', `Bearer ${alice.session}`)
      .expect(200);
    await request(server)
      .get(`/environments/${projectA.environmentId}/secrets`)
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(404);

    // Усі три grant-події потрапили в аудит org (без значень секретів).
    const grantAudit = await request(server)
      .get(
        `/audit?organizationId=${orgId}&action=grant.create&action=grant.update&action=grant.revoke`,
      )
      .set('Authorization', `Bearer ${alice.session}`)
      .expect(200);
    expect(
      (grantAudit.body as Array<{ action: string }>).map((e) => e.action),
    ).toEqual(
      expect.arrayContaining(['grant.create', 'grant.update', 'grant.revoke']),
    );
  });

  afterAll(async () => {
    await app.close();
  });
});
