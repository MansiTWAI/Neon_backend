-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DISPUTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "TechnicianStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionStatus" ADD VALUE 'CLAIMED';
ALTER TYPE "CommissionStatus" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "claimId" UUID;

-- AlterTable
ALTER TABLE "technicians" ADD COLUMN     "serviceCity" VARCHAR(80),
ADD COLUMN     "servicePincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" "TechnicianStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "commission_claims" (
    "id" UUID NOT NULL,
    "claimNo" VARCHAR(20) NOT NULL,
    "franchiseId" UUID NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "amountPaise" BIGINT NOT NULL,
    "note" TEXT,
    "submittedBy" UUID,
    "submittedAt" TIMESTAMPTZ,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" TEXT,
    "reconciledReference" VARCHAR(60),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commission_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_evidence" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fileName" VARCHAR(120) NOT NULL,
    "mime" VARCHAR(60) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_claims_claimNo_key" ON "commission_claims"("claimNo");

-- CreateIndex
CREATE INDEX "commission_claims_franchiseId_status_idx" ON "commission_claims"("franchiseId", "status");

-- CreateIndex
CREATE INDEX "commission_claims_status_submittedAt_idx" ON "commission_claims"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "claim_evidence_claimId_idx" ON "claim_evidence"("claimId");

-- CreateIndex
CREATE INDEX "commissions_claimId_idx" ON "commissions"("claimId");

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "commission_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "commission_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Technicians that were switched off keep that state as SUSPENDED.
UPDATE "technicians" SET "status" = 'SUSPENDED' WHERE "isActive" = false;
