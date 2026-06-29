-- Remember the workspace a human last used, to redirect them there from root.
-- Plain pointer (no FK): validated against current membership on read/write.
ALTER TABLE "Identity" ADD COLUMN "lastActiveOrgId" TEXT;
