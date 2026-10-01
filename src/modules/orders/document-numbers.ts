import { Prisma } from '@prisma/client';

/** NA10001, NA10002, … Backed by a Postgres sequence, so concurrent checkouts never collide. */
export async function nextOrderNo(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<[{ value: bigint }]>`SELECT nextval('order_no_seq') AS value`;
  return `NA${row.value}`;
}

export async function nextQuoteNo(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<[{ value: bigint }]>`SELECT nextval('quote_no_seq') AS value`;
  return `QT${row.value}`;
}
