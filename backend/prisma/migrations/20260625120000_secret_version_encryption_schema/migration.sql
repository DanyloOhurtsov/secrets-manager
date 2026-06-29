-- Маркер схеми шифрування для кожної версії секрету.
-- 1 = legacy (AES-GCM без AAD), 2 = AAD-binding (значення й data-key привʼязані
-- до незмінного контексту: secretId/secretVersionId/environmentId/keyVersion).
-- Наявні рядки лишаються legacy (DEFAULT 1) і мусять розшифровуватись без AAD;
-- нові версії додаток пише як 2.
ALTER TABLE "SecretVersion" ADD COLUMN "encryptionSchemaVersion" INTEGER NOT NULL DEFAULT 1;
