-- false for accounts created through Google sign-in: their stored hash is random
-- and unknown to anyone, so they may set a first password without a current one.
-- Existing rows default to true (email/password accounts and Google-linked ones).
ALTER TABLE "User" ADD COLUMN "hasPassword" BOOLEAN NOT NULL DEFAULT true;
