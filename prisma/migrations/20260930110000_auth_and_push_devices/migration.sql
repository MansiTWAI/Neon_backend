-- CreateEnum
CREATE TYPE "AuthAudience" AS ENUM ('CUSTOMER', 'ADMIN', 'FRANCHISE', 'TECHNICIAN');

-- AlterEnum
ALTER TYPE "UserType" ADD VALUE 'TECHNICIAN';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "readAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "audience" "AuthAudience" NOT NULL;

-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "audience" "AuthAudience" NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "ip" VARCHAR(45),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "app" VARCHAR(20) NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phone_createdAt_idx" ON "otp_challenges"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "technicians_userId_key" ON "technicians"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "technicians_phone_key" ON "technicians"("phone");

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

