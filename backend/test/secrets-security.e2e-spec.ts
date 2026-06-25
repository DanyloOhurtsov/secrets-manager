import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';

// Security-focused e2e suite for the secrets module. Покриває:
//   - тенант-ізоляцію (read/update/delete між організаціями → 404, ховаємо існування);
//   - відсутність плейнтексту в БД;
//   - тамперостійкість завдяки AES-256-GCM + AAD (підміна ciphertext, org-контексту,
//     identity секрету, auth tag, IV) — усе має давати безпечний 422 без витоку.
//
// Усі значення тут — тестові (test-safe), жодних реальних секретів/ключів/токенів.

describe('Secrets security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let server: App;
  let redis: Redis;

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
    server = app.getHttpServer();
    // Окреме зʼєднання для скидання rate-limit лічильників між тестами. Throttling
    // тут не предмет тестування, а десятки signup-ів за секунди інакше вперлися б
    // у ліміти (5/60с на signup). Чистимо стан перед кожним тестом, щоб кожен
    // починався з чистого вікна — самі ліміти лишаються активними в межах тесту.
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });

  beforeEach(async () => {
    await redis.flushdb();
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

  afterAll(async () => {
    // Лишаємо чисте rate-limit вікно для інших e2e-файлів, що ділять цей Redis.
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  // --- Хелпери --------------------------------------------------------------

  interface Tenant {
    session: string;
    identityId: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
  }

  // Створює орг + адміна в ній: signup дає особисту org із роллю owner, а
  // створення проєкту автоматично видає творцю project-admin grant (reveal/
  // create/update/delete). Тобто адмін має повний доступ до СВОЇХ секретів.
  async function createTenant(label: string): Promise<Tenant> {
    const signup = await request(server)
      .post('/signup')
      .send({
        name: label,
        email: `${label}@example.com`,
        password: 'password-123',
      })
      .expect(201);
    const session = signup.body.sessionToken as string;
    const identityId = signup.body.identity.id as string;

    const projectRes = await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${session}`)
      .send({ name: `${label}-project` })
      .expect(201);
    const projectId = projectRes.body.id as string;
    const organizationId = projectRes.body.organizationId as string;

    const envRes = await request(server)
      .post(`/projects/${projectId}/environments`)
      .set('Authorization', `Bearer ${session}`)
      .send({ name: 'production' })
      .expect(201);
    const environmentId = envRes.body.id as string;

    return { session, identityId, organizationId, projectId, environmentId };
  }

  async function createSecret(
    t: Tenant,
    key: string,
    value: string,
  ): Promise<string> {
    const res = await request(server)
      .post(`/environments/${t.environmentId}/secrets`)
      .set('Authorization', `Bearer ${t.session}`)
      .send({ key, value })
      .expect(201);
    return res.body.id as string;
  }

  function reveal(t: Tenant, secretId: string) {
    return request(server)
      .get(`/environments/${t.environmentId}/secrets/${secretId}/reveal`)
      .set('Authorization', `Bearer ${t.session}`);
  }

  // Поточна (активна) версія секрету з усіма крипто-полями конверта.
  async function currentVersion(secretId: string) {
    const secret = await prisma.secret.findUniqueOrThrow({
      where: { id: secretId },
      include: { currentVersion: true },
    });
    if (!secret.currentVersion) throw new Error('no current version');
    return secret.currentVersion;
  }

  // Копіює увесь зашифрований payload джерельної версії у цільовий рядок,
  // НЕ змінюючи id/secretId/version цілі (їхній логічний контекст лишається).
  async function copyEnvelope(fromVersionId: string, toVersionId: string) {
    const src = await prisma.secretVersion.findUniqueOrThrow({
      where: { id: fromVersionId },
    });
    await prisma.secretVersion.update({
      where: { id: toVersionId },
      data: {
        ciphertext: src.ciphertext,
        valueIv: src.valueIv,
        valueAuthTag: src.valueAuthTag,
        encryptedDataKey: src.encryptedDataKey,
        dataKeyIv: src.dataKeyIv,
        dataKeyAuthTag: src.dataKeyAuthTag,
        keyVersion: src.keyVersion,
        encryptionSchemaVersion: src.encryptionSchemaVersion,
      },
    });
  }

  // --- 1. Захист від плейнтексту в БД ---------------------------------------

  it('does not store the plaintext secret value in the database', async () => {
    const alice = await createTenant('alice');
    const plaintext = 'postgres://org-a-secret-value';
    const secretId = await createSecret(alice, 'DATABASE_URL', plaintext);

    const version = await currentVersion(secretId);

    // Жоден байтовий стовпець конверта не містить плейнтексту.
    const needle = Buffer.from(plaintext, 'utf-8');
    const blobs = [
      version.ciphertext,
      version.valueIv,
      version.valueAuthTag,
      version.encryptedDataKey,
      version.dataKeyIv,
      version.dataKeyAuthTag,
    ];
    for (const blob of blobs) {
      expect(Buffer.from(blob).includes(needle)).toBe(false);
    }

    // Натомість збережено лише матеріал шифрування: ciphertext, IV (12 байт),
    // auth tag (16 байт), обгорнутий data-key, keyVersion і схему AAD+org.
    expect(Buffer.from(version.ciphertext).length).toBeGreaterThan(0);
    expect(Buffer.from(version.valueIv).length).toBe(12);
    expect(Buffer.from(version.valueAuthTag).length).toBe(16);
    expect(Buffer.from(version.encryptedDataKey).length).toBeGreaterThan(0);
    expect(Buffer.from(version.dataKeyIv).length).toBe(12);
    expect(Buffer.from(version.dataKeyAuthTag).length).toBe(16);
    expect(version.keyVersion).toBeTruthy();
    expect(version.encryptionSchemaVersion).toBe(3); // SCHEMA_AAD_ORG
  });

  // --- 2. Доступ до власного тенанта працює ---------------------------------

  it('lets an org admin read, list and reveal their own secret', async () => {
    const alice = await createTenant('alice');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'postgres://tenant-a',
    );

    // Список без reveal — лише метадані, значення приховане.
    const listed = await request(server)
      .get(`/environments/${alice.environmentId}/secrets`)
      .set('Authorization', `Bearer ${alice.session}`)
      .expect(200);
    expect(listed.body).toMatchObject([
      { key: 'DATABASE_URL', currentVersion: 1, value: null },
    ]);

    // Явний reveal одного секрету повертає очікуваний плейнтекст.
    const revealed = await reveal(alice, secretId).expect(200);
    expect(revealed.body).toMatchObject({
      id: secretId,
      value: 'postgres://tenant-a',
    });

    // Bulk reveal (CLI-шлях) теж повертає значення авторизованому актору.
    const bulk = await request(server)
      .get(`/environments/${alice.environmentId}/secrets`)
      .query({ reveal: 'true' })
      .set('Authorization', `Bearer ${alice.session}`)
      .expect(200);
    expect(bulk.body).toMatchObject([
      { key: 'DATABASE_URL', value: 'postgres://tenant-a' },
    ]);
  });

  // --- 3. Крос-тенант read → 404 (ховаємо існування) ------------------------

  it('returns 404 (not 403) when another organization tries to read a secret', async () => {
    const alice = await createTenant('alice');
    const bob = await createTenant('bob');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'postgres://tenant-a',
    );

    // Bob не бачить навіть існування оточення/секрету Alice.
    await request(server)
      .get(`/environments/${alice.environmentId}/secrets`)
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(404);

    await reveal(bob, secretId).expect(404);
  });

  // --- 4. Крос-тенант update → 404, у БД нічого не змінилось -----------------

  it('returns 404 when another organization tries to update a secret and leaves it unchanged', async () => {
    const alice = await createTenant('alice');
    const bob = await createTenant('bob');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'postgres://tenant-a',
    );
    const before = await currentVersion(secretId);

    await request(server)
      .patch(`/environments/${alice.environmentId}/secrets/${secretId}`)
      .set('Authorization', `Bearer ${bob.session}`)
      .send({ value: 'postgres://attacker-controlled' })
      .expect(404);

    // Нової версії не зʼявилось, ciphertext не змінився.
    const after = await currentVersion(secretId);
    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version);
    expect(
      Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext)),
    ).toBe(true);

    // Значення Alice лишилось коректним.
    const revealed = await reveal(alice, secretId).expect(200);
    expect(revealed.body.value).toBe('postgres://tenant-a');
  });

  // --- 5. Крос-тенант delete → 404, секрет лишається в БД -------------------

  it('returns 404 when another organization tries to delete a secret and keeps it intact', async () => {
    const alice = await createTenant('alice');
    const bob = await createTenant('bob');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'postgres://tenant-a',
    );

    await request(server)
      .delete(`/environments/${alice.environmentId}/secrets/${secretId}`)
      .set('Authorization', `Bearer ${bob.session}`)
      .expect(404);

    const stillThere = await prisma.secret.findUnique({
      where: { id: secretId },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.deletedAt).toBeNull();
  });

  // --- 6. Атака підміни ciphertext (найважливіший тест) ---------------------

  it('rejects ciphertext copied from another organization due to AAD mismatch', async () => {
    const alice = await createTenant('alice');
    const bob = await createTenant('bob');

    const secretAId = await createSecret(
      alice,
      'DATABASE_URL',
      'org-a-database-url',
    );
    const secretBId = await createSecret(
      bob,
      'DATABASE_URL',
      'org-b-database-url',
    );

    const versionA = await currentVersion(secretAId);
    const versionB = await currentVersion(secretBId);

    // DB-атака: увесь зашифрований payload A підкладено у рядок версії B.
    // org/secret/version самого рядка B НЕ змінюємо — лише крипто-матеріал.
    await copyEnvelope(versionA.id, versionB.id);

    // Bob авторизовано читає СВІЙ секрет, але AAD-контекст B ≠ контекст A →
    // автентифіковане шифрування відхиляє розшифрування (не authz, а крипто).
    const res = await reveal(bob, secretBId).expect(422);

    // Жодного плейнтексту в відповіді — ні A, ні B.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('org-a-database-url');
    expect(body).not.toContain('org-b-database-url');
    expect(res.body.message).toMatch(
      /integrity check failed|could not be decrypted/i,
    );

    // Definition of done: рядок A лишається непрочитаним і у вигляді B —
    // тобто плейнтекст A НЕ витік під чужою організацією.
    const probe = await reveal(bob, secretBId).expect(422);
    expect(JSON.stringify(probe.body)).not.toContain('org-a-database-url');
  });

  // --- 7. AAD: підміна організаційного контексту ----------------------------

  it('fails decryption when the secret organization context is changed (AAD org binding)', async () => {
    const alice = await createTenant('alice');
    const other = await createTenant('bob'); // лише щоб мати другу реальну org
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'org-a-secret-value',
    );

    // Контроль: до підміни reveal працює.
    const ok = await reveal(alice, secretId).expect(200);
    expect(ok.body.value).toBe('org-a-secret-value');

    // Прямо в БД зміщуємо org-контекст проєкту (payload секрету не чіпаємо).
    // Project-grant Alice лишається (пряме оновлення оминає revoke у transfer),
    // тож авторизація проходить — але AAD тепер будується з ІНШИМ organizationId.
    await prisma.project.update({
      where: { id: alice.projectId },
      data: { organizationId: other.organizationId },
    });

    const res = await reveal(alice, secretId).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('org-a-secret-value');
  });

  // --- 8. AAD: підміна identity секрету в межах однієї org ------------------

  it('fails decryption when ciphertext is copied between secrets in the same org (AAD secret binding)', async () => {
    const alice = await createTenant('alice');
    const firstId = await createSecret(
      alice,
      'SECRET_ONE',
      'value-of-secret-one',
    );
    const secondId = await createSecret(
      alice,
      'SECRET_TWO',
      'value-of-secret-two',
    );

    const first = await currentVersion(firstId);
    const second = await currentVersion(secondId);

    // Та сама організація → org у AAD збігається. Але secretId/versionId інші,
    // тож копія payload першого секрету у другий все одно не розшифровується.
    await copyEnvelope(first.id, second.id);

    const res = await reveal(alice, secondId).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('value-of-secret-one');
  });

  // --- 9. Підміна auth tag --------------------------------------------------

  it('fails decryption when the auth tag is tampered', async () => {
    const alice = await createTenant('alice');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'tamper-the-tag',
    );
    const version = await currentVersion(secretId);

    const tag = Buffer.from(version.valueAuthTag);
    tag[0] ^= 0xff; // фліп одного байта
    await prisma.secretVersion.update({
      where: { id: version.id },
      data: { valueAuthTag: tag },
    });

    const res = await reveal(alice, secretId).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('tamper-the-tag');
  });

  // --- 10. Підміна IV/nonce -------------------------------------------------

  it('fails decryption when the nonce/IV is tampered', async () => {
    const alice = await createTenant('alice');
    const secretId = await createSecret(
      alice,
      'DATABASE_URL',
      'tamper-the-nonce',
    );
    const version = await currentVersion(secretId);

    const iv = Buffer.from(version.valueIv);
    iv[0] ^= 0xff;
    await prisma.secretVersion.update({
      where: { id: version.id },
      data: { valueIv: iv },
    });

    const res = await reveal(alice, secretId).expect(422);
    expect(JSON.stringify(res.body)).not.toContain('tamper-the-nonce');
  });

  // --- 10b. Невідома версія master-ключа → безпечний 500 (не 422) ----------

  it('fails safe with a server error (not 422) when the master key version is unknown', async () => {
    const alice = await createTenant('alice');
    const plaintext = 'value-for-unknown-key';
    const secretId = await createSecret(alice, 'DATABASE_URL', plaintext);
    const version = await currentVersion(secretId);

    // Рядок посилається на версію master-ключа, якої нема в MASTER_KEYS —
    // конфігурація сервера, а не підміна даних. Має бути 500, не 422.
    await prisma.secretVersion.update({
      where: { id: version.id },
      data: { keyVersion: 'v-nonexistent' },
    });

    const res = await reveal(alice, secretId).expect(500);

    // Не маскується під integrity-failure і нічого не зливає (ні keyVersion,
    // ні плейнтекст, ні крипто-внутрішнощі).
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('v-nonexistent');
    expect(body).not.toContain(plaintext);
    expect(body).not.toMatch(/integrity check failed/i);
  });

  // --- 11. Безпечна відповідь про помилку (без витоку внутрішніх деталей) ----

  it('returns a safe error response that leaks no plaintext or crypto internals', async () => {
    const alice = await createTenant('alice');
    const plaintext = 'super-secret-connection-string';
    const secretId = await createSecret(alice, 'DATABASE_URL', plaintext);
    const version = await currentVersion(secretId);

    // Псуємо auth tag → гарантований збій розшифрування.
    const tag = Buffer.from(version.valueAuthTag);
    tag[0] ^= 0xff;
    await prisma.secretVersion.update({
      where: { id: version.id },
      data: { valueAuthTag: tag },
    });

    const res = await reveal(alice, secretId).expect(422);

    // Тіло — лише стандартний Nest-конверт помилки, без stack/внутрішніх полів.
    expect(Object.keys(res.body).sort()).toEqual([
      'error',
      'message',
      'statusCode',
    ]);
    expect(res.body).not.toHaveProperty('stack');

    const body = JSON.stringify(res.body);
    // Жодного плейнтексту, ключів, токенів, AAD чи крипто-матеріалу.
    expect(body).not.toContain(plaintext);
    expect(body.toLowerCase()).not.toContain('aad');
    expect(body).not.toContain(process.env.MASTER_KEYS ?? 'MASTER_KEYS_UNSET');
    expect(body).not.toContain(alice.session);
    // Серіалізований крипто-матеріал теж не має просочитися у відповідь.
    expect(body).not.toContain(
      Buffer.from(version.valueAuthTag).toString('base64'),
    );
    expect(body).not.toContain(
      Buffer.from(version.ciphertext).toString('base64'),
    );
    expect(body).not.toContain(Buffer.from(version.valueIv).toString('base64'));
    // Жодних слідів стек-трейсу/шляхів до файлів.
    expect(body).not.toMatch(/\bat \w+.*\(.*\.[jt]s:\d+/);
  });

  // --- 12. Відсутність плейнтексту в логах ----------------------------------

  it('does not leak plaintext secret values to process logs', async () => {
    const plaintext = 'postgres://do-not-log-this-value';

    // Перехоплюємо stdout/stderr (Nest Logger пише саме туди). mockReturnValue
    // глушить вивід лише на час тесту; самі аргументи перевіряємо через mock.calls.
    const outSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    try {
      const alice = await createTenant('alice');
      const secretId = await createSecret(alice, 'DATABASE_URL', plaintext);

      // Тригеримо ще й збій розшифрування — шлях помилки теж не має логувати значення.
      const version = await currentVersion(secretId);
      const tag = Buffer.from(version.valueAuthTag);
      tag[0] ^= 0xff;
      await prisma.secretVersion.update({
        where: { id: version.id },
        data: { valueAuthTag: tag },
      });
      await reveal(alice, secretId).expect(422);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    const written = [...outSpy.mock.calls, ...errSpy.mock.calls]
      .map(([chunk]) =>
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      .join('');
    expect(written).not.toContain(plaintext);

    // TODO(logging): коли застосунок отримає структурований логер (pino/winston)
    // із тестовим транспортом — перенести перевірку на захоплення тих логів і
    // додатково покрити redaction-серіалізатори (щоб поля значень маскувались
    // навіть якщо їх випадково передадуть у логер).
  });
});
