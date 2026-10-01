import { isGstStateCode, isValidGstin } from '@neon-adda/shared';
import { z } from 'zod';
import { indianMobileSchema } from '../auth/auth.dto';
import { pincodeSchema } from '../pricing/pricing.dto';

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const addressSchema = z
  .object({
    label: optionalText(30),
    name: text(80),
    phone: indianMobileSchema,
    line1: text(160),
    line2: optionalText(160),
    landmark: optionalText(160),
    city: text(80),
    stateCode: z.string().refine(isGstStateCode, 'Choose a state'),
    pincode: pincodeSchema,
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((value) => value || null)
      .refine((value) => value === null || isValidGstin(value), 'Enter a valid 15-character GSTIN'),
    businessName: optionalText(120),
    isDefault: z.boolean().default(false),
  })
  .superRefine((address, ctx) => {
    // The GSTIN's state has to match the address it is registered at, or the invoice is wrong.
    if (address.gstin && address.gstin.slice(0, 2) !== address.stateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'This GSTIN is registered in a different state',
      });
    }
    if (address.gstin && !address.businessName) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessName'],
        message: 'Enter the business name for the GST invoice',
      });
    }
  });

export type AddressDto = z.infer<typeof addressSchema>;
