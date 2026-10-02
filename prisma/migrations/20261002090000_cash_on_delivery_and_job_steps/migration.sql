-- Orders are paid in cash on delivery until online payments are switched on.
ALTER TYPE "PaymentMode" ADD VALUE 'COD';

-- Technicians accept a visit before setting out, and visits of cancelled orders are called off.
ALTER TYPE "JobStatus" ADD VALUE 'ACCEPTED' BEFORE 'ON_THE_WAY';
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';
