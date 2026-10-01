export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'EXPIRED'
  | 'CONFIRMED'
  | 'PROOF_PENDING'
  | 'PROOF_APPROVED'
  | 'IN_PRODUCTION'
  | 'QUALITY_CHECK'
  | 'READY_TO_DISPATCH'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'INSTALLED'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'CANCELLED';

export type OrderPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type QuotationStatus =
  'REQUESTED' | 'IN_REVIEW' | 'SENT' | 'CHANGES_REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/** Customers may cancel on their own until production starts; after that it goes through support. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PROOF_PENDING'];

/** Reviews open once the sign has reached the customer. */
export const REVIEWABLE: readonly OrderStatus[] = ['DELIVERED', 'INSTALLED', 'COMPLETED'];

export type OrderStage =
  'PLACED' | 'CONFIRMED' | 'PROOF' | 'PRODUCTION' | 'DISPATCHED' | 'DELIVERED' | 'INSTALLED';

const STAGE_OF: Record<OrderStatus, OrderStage | null> = {
  PENDING_PAYMENT: 'PLACED',
  EXPIRED: null,
  CONFIRMED: 'CONFIRMED',
  PROOF_PENDING: 'PROOF',
  PROOF_APPROVED: 'PROOF',
  IN_PRODUCTION: 'PRODUCTION',
  QUALITY_CHECK: 'PRODUCTION',
  READY_TO_DISPATCH: 'PRODUCTION',
  SHIPPED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  INSTALLED: 'INSTALLED',
  COMPLETED: 'INSTALLED',
  ON_HOLD: null,
  CANCELLED: null,
};

/** The progress steps shown to the customer, in order. Installation only appears when it was booked. */
export function orderStages(installation: boolean): OrderStage[] {
  const stages: OrderStage[] = ['PLACED', 'CONFIRMED', 'PROOF', 'PRODUCTION', 'DISPATCHED', 'DELIVERED'];
  return installation ? [...stages, 'INSTALLED'] : stages;
}

/** Index of the current step in `orderStages`, or -1 for orders that left the normal flow. */
export function currentStageIndex(status: OrderStatus, installation: boolean): number {
  const stages = orderStages(installation);
  if (status === 'COMPLETED') return stages.length - 1;
  const stage = STAGE_OF[status];
  return stage ? stages.indexOf(stage) : -1;
}

/**
 * Status changes staff can make by hand. Payment, proof approval and installation completion
 * move orders on their own and are not listed here.
 */
export const STAFF_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['EXPIRED', 'CANCELLED'],
  CONFIRMED: ['ON_HOLD', 'CANCELLED'],
  PROOF_PENDING: ['ON_HOLD', 'CANCELLED'],
  PROOF_APPROVED: ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  IN_PRODUCTION: ['QUALITY_CHECK', 'ON_HOLD'],
  QUALITY_CHECK: ['READY_TO_DISPATCH', 'IN_PRODUCTION'],
  READY_TO_DISPATCH: ['SHIPPED', 'ON_HOLD'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['INSTALLED', 'COMPLETED'],
  INSTALLED: ['COMPLETED'],
};

export function canStaffMove(from: OrderStatus, to: OrderStatus): boolean {
  return STAFF_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses where the order still counts as open work. */
export const OPEN_STATUSES: readonly OrderStatus[] = [
  'CONFIRMED',
  'PROOF_PENDING',
  'PROOF_APPROVED',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'READY_TO_DISPATCH',
  'SHIPPED',
  'DELIVERED',
  'INSTALLED',
  'ON_HOLD',
];
