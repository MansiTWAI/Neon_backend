import { z } from 'zod';

export const calculatePriceSchema = z.object({
  productId: z.string().uuid().optional(),
  productType: z.enum(['TEXT_NEON', 'LOGO_NEON', 'READYMADE', 'BUSINESS']).optional(),
  backboardCode: z.string().min(2).max(20),
  widthIn: z.number().positive().max(600),
  heightIn: z.number().positive().max(600),
  colorCount: z.number().int().min(1).max(10).default(1),
  addonCodes: z.array(z.string().max(30)).max(10).default([]),
  qty: z.number().int().min(1).max(100).default(1),
  installation: z.boolean().default(false),
  pincode: z
    .string()
    .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode')
    .optional(),
  couponCode: z
    .string()
    .regex(/^[A-Za-z0-9]{4,20}$/, 'Coupon codes are 4–20 letters or digits')
    .optional(),
  billingStateCode: z
    .string()
    .regex(/^\d{2}$/, 'Use the 2-digit GST state code')
    .optional(),
});

export type CalculatePriceDto = z.infer<typeof calculatePriceSchema>;

export const pincodeSchema = z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode');
