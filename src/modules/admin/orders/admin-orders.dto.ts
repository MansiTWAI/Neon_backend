import { z } from 'zod';
import { pageSchema, searchSchema } from '../../../common/http/pagination';

/** The work queues on the orders screen; each is a fixed filter staff use every day. */
export const ORDER_QUEUES = [
  'all',
  'awaiting-payment',
  'needs-proof',
  'with-customer',
  'production',
  'dispatch',
  'installation',
  'on-hold',
  'support',
  'closed',
] as const;
export type OrderQueue = (typeof ORDER_QUEUES)[number];

export const orderListSchema = pageSchema.extend({
  queue: z.enum(ORDER_QUEUES).default('all').catch('all'),
  q: searchSchema,
  franchiseId: z.string().uuid().optional().catch(undefined),
});
export type OrderListQuery = z.infer<typeof orderListSchema>;

const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'EXPIRED',
  'CONFIRMED',
  'PROOF_PENDING',
  'PROOF_APPROVED',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'READY_TO_DISPATCH',
  'SHIPPED',
  'DELIVERED',
  'INSTALLED',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const statusChangeSchema = z
  .object({
    to: z.enum(ORDER_STATUSES),
    note: optionalText(500),
    courierName: optionalText(60),
    awbNo: optionalText(40),
    trackingUrl: z
      .string()
      .trim()
      .url('Enter a full tracking link')
      .max(300)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((dto, ctx) => {
    if (dto.to === 'SHIPPED' && (!dto.courierName || !dto.awbNo)) {
      ctx.addIssue({ code: 'custom', path: ['awbNo'], message: 'Enter the courier and tracking number' });
    }
    if ((dto.to === 'ON_HOLD' || dto.to === 'CANCELLED') && !dto.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Give a reason' });
    }
  });
export type StatusChangeDto = z.infer<typeof statusChangeSchema>;

export const recordPaymentSchema = z.object({
  amountPaise: z.number().int().positive().max(100_000_000_00),
  method: z.enum(['OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK', 'PAYMENT_LINK']),
  reference: optionalText(60),
  receivedAt: z.coerce
    .date()
    .max(new Date(Date.now() + 60_000), 'Cannot be in the future')
    .optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const installationSchema = z
  .object({
    technicianId: z.string().uuid().nullable(),
    scheduledStart: z.coerce.date().nullable(),
    durationHours: z.number().min(0.5).max(12).default(2),
    notes: optionalText(500),
  })
  .refine((dto) => !dto.technicianId || dto.scheduledStart, {
    path: ['scheduledStart'],
    message: 'Pick a date and time for the technician',
  });
export type InstallationDto = z.infer<typeof installationSchema>;

export const ticketUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  resolution: optionalText(2000),
});
export type TicketUpdateDto = z.infer<typeof ticketUpdateSchema>;
