-- Link a DocLens account to a Google account (the ID token's "sub" claim).
-- Nullable: email/password accounts keep working unchanged.
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
