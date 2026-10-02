import { z } from 'zod';
import { designSchema, previewSchema } from '../designs/design.dto';
import { pincodeSchema } from '../pricing/pricing.dto';

const MAX_LINES = 10;

const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,20}$/, 'Coupon codes are 4 to 20 letters or digits');

const line = z.object({ design: designSchema, qty: z.number().int().min(1).max(100) });

export const checkoutPriceSchema = z.object({
  lines: z.array(line).min(1).max(MAX_LINES),
  pincode: pincodeSchema.optional(),
  /** GST state of the billing address, so the preview shows CGST/SGST or IGST correctly. */
  billingStateCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  installation: z.boolean().default(false),
  couponCode: couponCode.optional(),
});
export type CheckoutPriceDto = z.infer<typeof checkoutPriceSchema>;

export const placeOrderSchema = z.object({
  lines: z
    .array(line.extend({ preview: previewSchema.optional() }))
    .min(1)
    .max(MAX_LINES),
  addressId: z.string().uuid(),
  installation: z.boolean().default(false),
  couponCode: couponCode.optional(),
  /**
   * Cash on delivery only, until online payments are switched on. Older storefront builds still
   * send FULL or ADVANCE; those orders are taken as cash on delivery too rather than refused.
   */
  paymentMode: z.literal('COD').catch('COD'),
  /** Partner code from a franchise's standee QR or link, so the order counts as theirs. */
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,12}$/)
    .optional()
    .catch(undefined),
  /** The total the customer saw. If the server's price differs, the order is not placed. */
  expectedPayablePaise: z.number().int().nonnegative(),
});
export type PlaceOrderDto = z.infer<typeof placeOrderSchema>;

export const orderNoSchema = z.string().regex(/^NA\d{5,9}$/, 'Not an order number');

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(3, 'Tell us why').max(300) });
export type CancelOrderDto = z.infer<typeof cancelOrderSchema>;

export const proofDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), comment: z.string().trim().max(500).optional() }),
  z.object({
    decision: z.literal('CHANGES'),
    comment: z.string().trim().min(5, 'Describe the changes you would like').max(1000),
  }),
]);
export type ProofDecisionDto = z.infer<typeof proofDecisionSchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});
export type ReviewDto = z.infer<typeof reviewSchema>;

export const TICKET_TYPES = [
  'DAMAGED',
  'NOT_WORKING',
  'WRONG_ITEM',
  'INSTALLATION',
  'DELIVERY',
  'OTHER',
] as const;

export const ticketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  description: z.string().trim().min(10, 'Tell us a little more').max(2000),
});
export type TicketDto = z.infer<typeof ticketSchema>;
