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
    const bobIdentityId = secondSignup.body.identity.id as string;
    expect(aliceSession).toMatch(/^sess_/);
    expect(bobSession).toMatch(/^sess_/);

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

    await request(app.getHttpServer())
      .get(`/audit?projectId=${projectId}`)
      .set('Authorization', `Bearer ${bobSession}`)
      .expect(403);

    const aliceSecrets = await request(app.getHttpServer())
      .get(`/environments/${environmentId}/secrets`)
      .set('Authorization', `Bearer ${aliceSession}`)
      .expect(200);
    expect(aliceSecrets.body).toMatchObject([
      {
        key: 'DATABASE_URL',
        currentVersion: 1,
        value: 'postgres://tenant-a',
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });
});
