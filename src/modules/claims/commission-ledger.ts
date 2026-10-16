import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Commission becomes payable once its return window has passed. Run before reading the ledger. */
export function promoteEligibleCommission(db: Db) {
  return db.commission.updateMany({
    where: { status: 'PENDING', eligibleAt: { lte: new Date() } },
    data: { status: 'ELIGIBLE' },
  });
}

/** A claim is worth what its commissions still are; reversed ones (cancelled orders) drop out. */
export async function refreshClaimAmounts(db: Db, claimIds: string[]) {
  for (const claimId of new Set(claimIds)) {
    const sum = await db.commission.aggregate({
      where: { claimId, status: { not: 'REVERSED' } },
      _sum: { amountPaise: true },
    });
    await db.commissionClaim.update({
      where: { id: claimId },
      data: { amountPaise: sum._sum.amountPaise ?? 0n },
    });
  }
}
