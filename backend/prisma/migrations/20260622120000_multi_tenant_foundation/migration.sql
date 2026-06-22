-- This migration intentionally resets the current single-tenant test schema.
-- Existing data is test-only and is dropped before creating the multi-tenant model.

DROP TABLE IF EXISTS "SecretVersion" CASCADE;
DROP TABLE IF EXISTS "Secret" CASCADE;
DROP TABLE IF EXISTS "Environment" CASCADE;
DROP TABLE IF EXISTS "Grant" CASCADE;
DROP TABLE IF EXISTS "OrganizationMembership" CASCADE;
DROP TABLE IF EXISTS "Session" CASCADE;
DROP TABLE IF EXISTS "Token" CASCADE;
DROP TABLE IF EXISTS "Project" CASCADE;
DROP TABLE IF EXISTS "Organization" CASCADE;
DROP TABLE IF EXISTS "Identity" CASCADE;
DROP TABLE IF EXISTS "AuditLog" CASCADE;

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Identity" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "passwordHash" TEXT,
  "type" TEXT NOT NULL,
  "isSuperadmin" BOOLEAN NOT NULL DEFAULT false,
  "serviceOrganizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Token" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Environment" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Secret" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "currentVersionId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecretVersion" (
  "id" TEXT NOT NULL,
  "secretId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "ciphertext" BYTEA NOT NULL,
  "valueIv" BYTEA NOT NULL,
  "valueAuthTag" BYTEA NOT NULL,
  "encryptedDataKey" BYTEA NOT NULL,
  "dataKeyIv" BYTEA NOT NULL,
  "dataKeyAuthTag" BYTEA NOT NULL,
  "keyVersion" TEXT NOT NULL,

  CONSTRAINT "SecretVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Grant" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "canRevealSecrets" BOOLEAN NOT NULL DEFAULT false,
  "canCreateSecrets" BOOLEAN NOT NULL DEFAULT false,
  "canUpdateSecrets" BOOLEAN NOT NULL DEFAULT false,
  "canDeleteSecrets" BOOLEAN NOT NULL DEFAULT false,
  "canRollbackSecrets" BOOLEAN NOT NULL DEFAULT false,
  "canManageGrants" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "organizationId" TEXT,
  "organizationName" TEXT,
  "projectId" TEXT,
  "environmentId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Identity_email_key" ON "Identity"("email");
CREATE INDEX "Identity_serviceOrganizationId_idx" ON "Identity"("serviceOrganizationId");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_identityId_key" ON "OrganizationMembership"("organizationId", "identityId");
CREATE INDEX "OrganizationMembership_identityId_idx" ON "OrganizationMembership"("identityId");
CREATE UNIQUE INDEX "Token_tokenHash_key" ON "Token"("tokenHash");
CREATE INDEX "Token_identityId_idx" ON "Token"("identityId");
CREATE UNIQUE INDEX "Session_sessionHash_key" ON "Session"("sessionHash");
CREATE INDEX "Session_identityId_idx" ON "Session"("identityId");
CREATE UNIQUE INDEX "Project_organizationId_name_key" ON "Project"("organizationId", "name");
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");
CREATE UNIQUE INDEX "Environment_projectId_name_key" ON "Environment"("projectId", "name");
CREATE INDEX "Environment_projectId_idx" ON "Environment"("projectId");
CREATE UNIQUE INDEX "Secret_currentVersionId_key" ON "Secret"("currentVersionId");
CREATE UNIQUE INDEX "Secret_environmentId_key_key" ON "Secret"("environmentId", "key");
CREATE INDEX "Secret_environmentId_idx" ON "Secret"("environmentId");
CREATE UNIQUE INDEX "SecretVersion_secretId_version_key" ON "SecretVersion"("secretId", "version");
CREATE INDEX "SecretVersion_secretId_idx" ON "SecretVersion"("secretId");
CREATE UNIQUE INDEX "Grant_identityId_scopeType_scopeId_key" ON "Grant"("identityId", "scopeType", "scopeId");
CREATE INDEX "Grant_projectId_idx" ON "Grant"("projectId");
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");
CREATE INDEX "AuditLog_environmentId_idx" ON "AuditLog"("environmentId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

ALTER TABLE "Identity" ADD CONSTRAINT "Identity_serviceOrganizationId_fkey" FOREIGN KEY ("serviceOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Token" ADD CONSTRAINT "Token_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Secret" ADD CONSTRAINT "Secret_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecretVersion" ADD CONSTRAINT "SecretVersion_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "Secret"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Secret" ADD CONSTRAINT "Secret_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SecretVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
