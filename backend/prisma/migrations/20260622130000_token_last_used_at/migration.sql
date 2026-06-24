-- Track when an API/CLI token was last used (best-effort, updated on cache-miss verify).
ALTER TABLE "Token" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
