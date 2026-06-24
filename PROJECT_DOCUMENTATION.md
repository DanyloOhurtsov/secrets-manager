# Secrets Manager — документація проєкту

English version: [PROJECT_DOCUMENTATION_EN.md](PROJECT_DOCUMENTATION_EN.md)

## 1. Огляд

Secrets Manager — це локальний/внутрішній менеджер секретів для командних проєктів. Система дозволяє:

- створювати організації, проєкти та середовища;
- зберігати секрети у зашифрованому вигляді;
- вести версії секретів і робити rollback;
- роздавати доступ користувачам і service account-ам через гранти;
- переглядати аудит дій;
- інжектити секрети в процеси через CLI.

Репозиторій складається з трьох окремих npm-пакетів. Кореневого workspace немає, тому залежності та команди запускаються окремо в кожній директорії.

```text
backend/   NestJS API, Prisma, PostgreSQL, Redis, авторизація, шифрування
frontend/  React + Vite SPA для роботи з організаціями, проєктами і секретами
cli/       CLI `secrets` для отримання секретів і запуску команд з env-змінними
```

## 2. Технологічний стек

Backend:

- NestJS 11;
- Prisma 7;
- PostgreSQL 16;
- Redis 7 для короткоживучого кешу токенів;
- AES-256-GCM envelope encryption;
- Jest для unit/e2e тестів.

Frontend:

- React 19;
- Vite;
- TypeScript;
- Tailwind CSS v4;
- shadcn/Radix UI primitives;
- lucide-react icons.

CLI:

- TypeScript;
- commander;
- Node.js child_process для запуску дочірньої команди.

## 3. Інфраструктура

Для локальної розробки в корені проєкту є `docker-compose.yml`:

```bash
docker compose up -d
```

Піднімаються:

- PostgreSQL: `localhost:5433`, база `secrets_manager`, користувач `dev`, пароль `dev`;
- Redis: `localhost:6379`.

Зупинка:

```bash
docker compose down
```

Якщо потрібно видалити локальні дані PostgreSQL:

```bash
docker compose down -v
```

## 4. Конфігурація backend

Backend читає `.env` з директорії `backend/`.

Мінімальний приклад `backend/.env`:

```env
DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager"
REDIS_URL="redis://localhost:6379"
PORT=3000

MASTER_KEYS="v1:<64_hex_chars>"
ACTIVE_KEY_VERSION="v1"
```

Пояснення змінних:

- `DATABASE_URL` — URL PostgreSQL для Prisma.
- `REDIS_URL` — URL Redis. Якщо не задано, backend використовує `redis://localhost:6379`.
- `PORT` — порт API. За замовчуванням `3000`.
- `MASTER_KEYS` — список master-ключів у форматі `version:hex`, розділений комами. Кожен ключ має бути 32 байти, тобто 64 hex-символи.
- `ACTIVE_KEY_VERSION` — версія ключа з `MASTER_KEYS`, якою шифруються нові секрети.

Згенерувати master key можна так:

```bash
openssl rand -hex 32
```

Приклад з двома ключами:

```env
MASTER_KEYS="v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ACTIVE_KEY_VERSION="v2"
```

Важливо: старі ключі не можна видаляти з `MASTER_KEYS`, доки в базі залишаються секрети, data key яких загорнутий цими версіями.

## 5. Перший запуск

1. Запустити інфраструктуру:

```bash
docker compose up -d
```

2. Встановити залежності backend:

```bash
cd backend
npm install
```

3. Створити `backend/.env` за прикладом вище.

4. Застосувати міграції:

```bash
npx prisma migrate dev
```

5. Створити першого superadmin:

```bash
npx ts-node src/bootstrap.ts
```

Команда створює identity `bootstrap-admin` і друкує API token з префіксом `sm_`. Токен показується один раз, його потрібно зберегти.

6. Запустити backend:

```bash
npm run start:dev
```

7. Запустити frontend в іншому терміналі:

```bash
cd frontend
npm install
npm run dev
```

Vite проксить запити `/api/*` на `http://localhost:3000/*`.

8. За потреби зібрати CLI:

```bash
cd cli
npm install
npm run build
```

## 6. Основні команди

Backend (`backend/`):

```bash
npm run start:dev      # dev-сервер NestJS
npm run build          # production build
npm run start:prod     # запуск dist/main
npm run lint           # ESLint з autofix
npm run test           # unit-тести
npm run test:e2e       # e2e-тести
npm run test:cov       # coverage
npx prisma migrate dev # міграції
npx prisma generate    # генерація Prisma client
```

Frontend (`frontend/`):

```bash
npm run dev      # Vite dev server
npm run build    # TypeScript build + Vite build
npm run lint     # ESLint
npm run preview  # preview production build
```

CLI (`cli/`):

```bash
npm run dev    # запуск через tsx
npm run build  # компіляція у dist/
```

## 7. Архітектура backend

Головний модуль `backend/src/app.module.ts` підключає:

- `AuthModule` — автентифікація token/session;
- `SignupModule` — реєстрація користувача і персонального workspace;
- `OrganizationsModule` — організації та membership;
- `ProjectsModule` — проєкти;
- `EnvironmentsModule` — середовища;
- `SecretsModule` — секрети, версії, rollback;
- `GrantsModule` — доступи до проєктів/середовищ;
- `ServiceAccountsModule` — service account-и та їх токени;
- `AccountModule` — персональні токени й активна організація;
- `AdminModule` — platform admin API;
- `AuditModule` — журнал аудиту;
- `CryptoModule` — шифрування;
- `CacheModule` — Redis cache.

Глобально застосовані:

- `ValidationPipe` з `whitelist`, `forbidNonWhitelisted`, `transform`;
- `ThrottlerGuard`, default limit `100` запитів на хвилину;
- `AuthGuard`, який вимагає `Authorization: Bearer ...` для всіх маршрутів, окрім `@Public()`.
- `helmet` з вузькою Content-Security-Policy та базовими security headers.

## 8. Модель даних

Основні сутності з `backend/prisma/schema.prisma`:

- `Organization` — workspace типу `personal` або `team`.
- `OrganizationMembership` — зв'язок identity з організацією та роль `owner`, `admin`, `member`.
- `Identity` — користувач або service account (`type: human | service`).
- `Project` — проєкт всередині організації.
- `Environment` — середовище всередині проєкту.
- `Secret` — ключ секрету в середовищі. Має `deletedAt` для soft delete.
- `SecretVersion` — immutable-версія значення секрету.
- `Grant` — доступ identity до проєкту або конкретного середовища.
- `Token` — API token з hash, expiry, revoke і `lastUsedAt`.
- `Session` — browser session token.
- `AuditLog` — журнал дій.

Ієрархія даних:

```text
Organization
  Project
    Environment
      Secret
        SecretVersion
```

`Secret.currentVersionId` вказує на активну версію. Старі версії залишаються для історії та rollback.

## 9. Автентифікація

Є два типи bearer credentials:

- `sess_...` — browser session, створюється через signup/login;
- `sm_...` — API token, створюється для користувача, service account-а або bootstrap superadmin.

`AuthGuard` читає `Authorization: Bearer <token>`:

- якщо токен починається з `sess_`, перевіряється через `SessionService`;
- інакше перевіряється через `TokenService`.

Токени не зберігаються у відкритому вигляді. У БД лежить SHA-256 hash.

Публічні маршрути:

- `POST /signup`;
- `POST /auth/login`.

Всі інші маршрути потребують bearer token.

## 10. Авторизація і ролі

Є два рівні доступу:

1. Роль в організації (`OrganizationMembership`):
   - `owner`;
   - `admin`;
   - `member`.

2. Грант (`Grant`) на:
   - весь проєкт (`scopeType = project`);
   - конкретне середовище (`scopeType = environment`).

Ролі грантів:

- `viewer`;
- `reader`;
- `readonly`;
- `developer`;
- `admin`.

Додаткові capability-прапорці:

- `canRevealSecrets`;
- `canCreateSecrets`;
- `canUpdateSecrets`;
- `canDeleteSecrets`;
- `canRollbackSecrets`;
- `canManageGrants` — legacy-поле сумісності; в поточній логіці не дає керувати грантами або проєктом.

Ключовий нюанс безпеки:

- `owner`/`admin` організації може керувати структурою проєкту, оточеннями та грантами;
- `owner`/`admin` організації не отримує автоматичного доступу до значень секретів;
- щоб побачити, створити, змінити, видалити або відкотити значення секрету, потрібен явний grant з відповідними дозволами.
- створення, оновлення і відкликання grant-ів доступні тільки `owner`/`admin` організації;
- project/environment grant з роллю `admin` дає повний data-plane доступ і `manageProject`, але не дає `manageGrants`.

Це зроблено навмисно: ownership не означає universal secret reveal.

Service account може працювати тільки в межах своєї організації (`serviceOrganizationId`).

`developer` за замовчуванням бачить metadata/list secret keys, але не бачить plaintext values і не може створювати, оновлювати, видаляти або rollback-ати секрети без явних capability-прапорців.

Platform admin (`Identity.isSuperadmin`) — це власник інстансу. Він може виконувати platform-level операції (`/admin/*`), але не отримує автоматичного доступу до tenant secret values і не є обхідним шляхом навколо tenant grants.

## 11. Шифрування секретів

Backend використовує envelope encryption:

1. Для кожного значення секрету генерується випадковий 32-байтний data key.
2. Значення секрету шифрується data key через AES-256-GCM.
3. Data key шифрується активним master key.
4. У БД зберігаються:
   - ciphertext значення;
   - IV і auth tag значення;
   - encrypted data key;
   - IV і auth tag data key;
   - `keyVersion`.

Plaintext значення секрету в БД не зберігається.

Ротація master key:

- endpoint: `POST /admin/rotate-keys`;
- доступ: тільки superadmin;
- операція перепаковує encrypted data key на активну версію master key;
- ciphertext самого секрету не перешифровується;
- якщо версія вже активна, запис пропускається.

Якщо перевірка цілісності AES-GCM не проходить, backend повертає помилку про можливе пошкодження або підміну даних.

## 12. API

Усі protected endpoints очікують:

```http
Authorization: Bearer <sess_or_sm_token>
Content-Type: application/json
```

### Auth

```http
POST /signup
POST /auth/login
DELETE /auth/session
GET  /auth/me
```

`POST /signup` створює human identity, персональну організацію і owner membership.

`POST /auth/login` повертає `sessionToken`.

`DELETE /auth/session` відкликає поточну browser-сесію. Endpoint працює тільки для `sess_...`; API tokens `sm_...` через нього не відкликаються.

### Account

```http
GET    /me/active-org
PUT    /me/active-org
GET    /me/tokens
POST   /me/tokens
DELETE /me/tokens/:tokenId
```

Використовується для активної організації в UI і персональних API tokens.

### Organizations

```http
POST   /organizations
GET    /organizations
GET    /organizations/:id
PATCH  /organizations/:id
DELETE /organizations/:id

POST   /organizations/:id/members
PATCH  /organizations/:id/members/:identityId
DELETE /organizations/:id/members/:identityId
POST   /organizations/:id/transfer-ownership
```

### Projects

```http
POST   /projects
GET    /projects
GET    /projects/:id
GET    /projects/:id/capabilities
POST   /projects/:id/transfer
DELETE /projects/:id
```

Якщо `organizationId` не передано при створенні проєкту, backend створює проєкт у personal workspace, де актор має роль `owner`.

### Environments

```http
POST   /projects/:projectId/environments
GET    /projects/:projectId/environments
PATCH  /projects/:projectId/environments/:id
DELETE /projects/:projectId/environments/:id
```

### Secrets

```http
POST   /environments/:environmentId/secrets
GET    /environments/:environmentId/secrets
GET    /environments/:environmentId/secrets?reveal=true
GET    /environments/:environmentId/secrets/capabilities
GET    /environments/:environmentId/secrets/:id/reveal
PATCH  /environments/:environmentId/secrets/:id
GET    /environments/:environmentId/secrets/:id/versions
POST   /environments/:environmentId/secrets/:id/rollback
DELETE /environments/:environmentId/secrets/:id
```

`GET /secrets?reveal=true` і `GET /:id/reveal` потребують права `revealSecrets`.

Rate limits:

- список секретів: `60/min`;
- reveal одного секрету: `30/min`;
- signup: `5/min`.
- login: `5/min`.

### Grants

```http
POST   /organizations/:organizationId/grants
GET    /organizations/:organizationId/grants
PATCH  /organizations/:organizationId/grants/:grantId
DELETE /organizations/:organizationId/grants/:grantId
```

Керувати грантами можуть тільки `owner` або `admin` організації.

### Service Accounts

```http
POST   /organizations/:organizationId/service-accounts
GET    /organizations/:organizationId/service-accounts
DELETE /organizations/:organizationId/service-accounts/:identityId

POST   /organizations/:organizationId/service-accounts/:identityId/tokens
GET    /organizations/:organizationId/service-accounts/:identityId/tokens
DELETE /organizations/:organizationId/service-accounts/:identityId/tokens/:tokenId
```

### Audit

Tenant-level audit:

```http
GET /audit
GET /audit/actions
```

Фільтри:

- `action`;
- `organizationId`;
- `projectId`;
- `environmentId`;
- `actorId`;
- `targetType`;
- `from`;
- `to`.

### Platform Admin

Маршрути `/admin/*` потребують `Identity.isSuperadmin = true`.

```http
GET  /admin/organizations
POST /admin/organizations/:id/suspend
POST /admin/organizations/:id/unsuspend

GET  /admin/audit
GET  /admin/audit/actions
GET  /admin/health
POST /admin/rotate-keys
```

Призупинена організація блокує доступ до своїх ресурсів навіть для owner/admin. Розморозити її може platform admin.

Для користувачів без зв'язку з проєктом backend повертає `404` незалежно від статусу організації. Це не дає стороннім користувачам визначати, чи існує проєкт у призупиненій організації.

## 13. Security headers

Backend застосовує `helmet` до всіх відповідей.

Content-Security-Policy налаштована явно і вузько:

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
```

Політика не містить `default-src *` або `unsafe-inline`. `upgrade-insecure-requests` не вмикається, щоб не ламати локальну HTTP-розробку. CORS не розширюється; у dev-режимі frontend ходить до API через Vite proxy.

## 14. Frontend

Frontend — SPA без окремої routing-бібліотеки. Маршрути обробляються у `frontend/src/lib/router.tsx` через History API.

Основні екрани:

- `/login` — вхід;
- `/signup` — реєстрація;
- `/orgs/:orgId/projects` — workspace організації;
- `/orgs/:orgId/projects/:projectId` — деталі проєкту;
- `/admin` — platform admin UI для superadmin.

Запити до API йдуть через `frontend/src/lib/api.ts`:

- додається префікс `/api`;
- bearer token береться з `localStorage`;
- помилки API перетворюються на `Error(message)`.

Logout для browser-сесії викликає `DELETE /auth/session`, а потім очищає `localStorage`. Якщо revoke-запит не вдався, frontend все одно очищає локальний стан; backend залишається джерелом істини для `revokedAt`.

Vite proxy:

```text
/api/* -> http://localhost:3000/*
```

## 15. CLI

CLI пакет називається `@secrets-manager/cli`, binary — `secrets`.

Команди:

```bash
secrets ping
secrets login --token <sm_token> --url http://localhost:3000
secrets whoami
secrets run -e <environmentId> -- <command...>
```

Конфігурація CLI:

- `SECRETS_API_URL` — API URL;
- `SECRETS_TOKEN` — API token;
- якщо env-змінних немає, CLI читає `~/.secrets-manager/config.json`.

`secrets login` записує конфіг у:

```text
~/.secrets-manager/config.json
```

Файл створюється з правами `0600`.

Після кожного запису CLI явно застосовує `chmod 0600`, тому файл звужується до безпечних прав навіть якщо він уже існував із ширшими permissions.

Приклад запуску команди з секретами:

```bash
secrets login --token sm_xxx --url http://localhost:3000
secrets run -e <environmentId> -- npm run start
```

CLI викликає:

```http
GET /environments/:environmentId/secrets?reveal=true
```

Потім додає кожну пару `{ key, value }` в environment дочірнього процесу і повертає exit code цього процесу.

Якщо API повертає `value: null` для секрету без права reveal, CLI не інжектить рядок `"null"` або `"undefined"` у process env. Такі секрети пропускаються, а в `stderr` друкується коротке попередження без значень секретів.

## 16. Тести

Unit-тести backend:

```bash
cd backend
npm run test
```

E2E-тести:

```bash
cd backend
TEST_DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager_test" npm run test:e2e
```

E2E-тести потребують окремої disposable бази. У коді тестів є захист від випадкового запуску на production/dev базі: назва бази має містити `test`.

Frontend build-перевірка:

```bash
cd frontend
npm run build
```

CLI build-перевірка:

```bash
cd cli
npm run build
```

## 17. Аудит

Backend пише `AuditLog` для важливих дій:

- реєстрація та login;
- створення організацій;
- дії з проєктами, середовищами, секретами;
- reveal секретів;
- керування грантами;
- service account-и й токени;
- platform admin дії.

Reveal секретів логуються окремо від звичайного перегляду списку.

Є два режими аудиту:

- `logRequired` — fail-closed: якщо audit row не записався, дія завершується помилкою `503 Audit log unavailable`;
- `logBestEffort` — best-effort: помилка audit запису логується на сервері, але не ламає запит.

Fail-closed використовується для security-critical дій: reveal секретів, зміни секретів, grant CRUD, token issue/revoke, service account дії, membership/ownership зміни, project/environment мутації та platform-admin мутації. Для більшості критичних мутацій audit write виконується в тій самій Prisma transaction, що й сама мутація, тому audit failure rollback-ає зміну.

`secret.reveal` аудиться до decrypt/return. Якщо audit недоступний, plaintext secret value не дешифрується і не повертається.

`secret.list` лишається best-effort, бо це read-only metadata без plaintext values.

## 18. Типовий сценарій роботи

1. Superadmin створюється через `src/bootstrap.ts`.
2. Користувач реєструється через `/signup` і отримує personal workspace.
3. Користувач створює team organization або працює в personal organization.
4. В організації створюється project.
5. У project створюються environments, наприклад `dev`, `staging`, `prod`.
6. Owner/admin організації додає учасників або service account-и.
7. Owner/admin видає grants на project або environment.
8. Користувачі з відповідними grants створюють, оновлюють або reveal-ять секрети.
9. CLI використовує service account token для запуску процесів із секретами в environment.

## 19. Безпекові правила проєкту

- Не комітити `.env`, реальні токени, master keys або дампи БД.
- Не видаляти старі master keys без повної ротації та перевірки даних.
- Для automation/CI краще використовувати service account token, а не human token.
- Видавати `revealSecrets` тільки тим identity, які реально мають бачити plaintext.
- Не використовувати `canManageGrants` як робочий дозвіл. Керування доступом у MVP — тільки через org `owner`/`admin`.
- Для production мати окремі Postgres/Redis і окремий набір master keys.
- При відкликанні токена backend інвалідовує Redis cache, тому токен має перестати працювати одразу.
- Browser logout відкликає server-side session. Якщо сесію вкрадено, потрібен revoke на сервері, а не лише очищення localStorage.
- Critical audit failures мають блокувати security-sensitive дії; не можна віддавати plaintext secret без audit record.

## 20. Troubleshooting

Backend падає з `MASTER_KEYS is not configured`:

- перевірити `backend/.env`;
- переконатися, що команда запускається з директорії `backend`;
- перевірити формат `MASTER_KEYS`.

Backend падає з `ACTIVE_KEY_VERSION is missing or unknown`:

- `ACTIVE_KEY_VERSION` має збігатися з однією з версій у `MASTER_KEYS`.

Prisma не бачить базу:

- перевірити, що `docker compose up -d` запущено;
- перевірити порт `5433`;
- перевірити `DATABASE_URL`.

Frontend отримує 401:

- перевірити, що token є у `localStorage`;
- повторно login/signup;
- переконатися, що backend запущений на `localhost:3000`.

CLI не може під'єднатися до API:

- запустити `secrets ping`;
- перевірити `SECRETS_API_URL` або `~/.secrets-manager/config.json`;
- перевірити, що backend слухає потрібний порт.

Користувач бачить проєкт, але не може reveal секрети:

- це очікувана модель безпеки;
- потрібно видати grant з `reader`, `readonly`, `admin` або `canRevealSecrets=true`.
