-- Soft-delete for secrets: keep version history instead of destroying it.
-- A tombstoned (deletedAt IS NOT NULL) secret can be revived by re-creating the same key.
ALTER TABLE "Secret" ADD COLUMN "deletedAt" TIMESTAMP(3);
