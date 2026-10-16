import { z } from 'zod';

const gatewayId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,30}$`), 'Not a payment reference');

export const verifyPaymentSchema = z.object({
  gatewayOrderId: gatewayId('order'),
  paymentId: gatewayId('pay'),
  signature: z.string().regex(/^[a-f0-9]{64}$/, 'Not a payment signature'),
});
export type VerifyPaymentDto = z.infer<typeof verifyPaymentSchema>;

export const paymentFailedSchema = z.object({
  gatewayOrderId: gatewayId('order'),
  code: z.string().trim().max(60).optional(),
  reason: z.string().trim().max(300).optional(),
});
export type PaymentFailedDto = z.infer<typeof paymentFailedSchema>;

export const refundSchema = z.object({
  paymentId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  reason: z.string().trim().min(3, 'Say why, for the record').max(300),
  /** For a refund paid by hand: the bank or UPI reference. */
  reference: z.string().trim().max(60).optional(),
});
export type RefundDto = z.infer<typeof refundSchema>;
