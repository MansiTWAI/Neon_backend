import { z } from 'zod';
import { designSchema, previewSchema } from '../designs/design.dto';
import { pincodeSchema } from '../pricing/pricing.dto';

export const QUOTE_KINDS = ['LOGO', 'LARGE', 'BULK', 'CUSTOM'] as const;

export const requestQuoteSchema = z
  .object({
    kind: z.enum(QUOTE_KINDS),
    design: designSchema.optional(),
    preview: previewSchema.optional(),
    /** Rough size when there is no studio design, e.g. a shop front described in words. */
    widthIn: z.number().min(4).max(600).optional(),
    heightIn: z.number().min(2).max(600).optional(),
    qty: z.number().int().min(1).max(1000).default(1),
    pincode: pincodeSchema,
    installation: z.boolean().default(false),
    message: z.string().trim().max(2000).optional(),
  })
  .superRefine((dto, ctx) => {
    if (dto.kind === 'LOGO' && dto.design?.config.mode !== 'LOGO') {
      ctx.addIssue({ code: 'custom', path: ['design'], message: 'Upload your logo' });
    }
    if (!dto.design && !dto.message) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Tell us what you have in mind' });
    }
  });
export type RequestQuoteDto = z.infer<typeof requestQuoteSchema>;

export const quoteResponseSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CHANGES'),
    comment: z.string().trim().min(5, 'Tell us what to change').max(1000),
  }),
  z.object({ decision: z.literal('REJECT'), comment: z.string().trim().max(1000).optional() }),
]);
export type QuoteResponseDto = z.infer<typeof quoteResponseSchema>;

export const acceptQuoteSchema = z.object({ addressId: z.string().uuid() });
export type AcceptQuoteDto = z.infer<typeof acceptQuoteSchema>;
