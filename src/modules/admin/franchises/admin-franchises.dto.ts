import { isGstStateCode, isValidGstin } from '@neon-adda/shared';
import { z } from 'zod';
import { searchSchema } from '../../../common/http/pagination';
import { indianMobileSchema } from '../../auth/auth.dto';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const franchiseListSchema = z.object({ q: searchSchema });

const franchiseFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,12}$/, '3 to 12 letters or digits'),
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(80),
  stateCode: z.string().refine(isGstStateCode, 'Choose a state'),
  tierId: z.string().uuid().nullable(),
  status: z.enum(['PENDING_KYC', 'ACTIVE', 'SUSPENDED']),
  phone: indianMobileSchema.nullable().or(z.literal('').transform(() => null)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .nullable()
    .or(z.literal('').transform(() => null)),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((value) => value || null)
    .refine((value) => value === null || isValidGstin(value), 'Enter a valid GSTIN'),
  address: optional(300),
  maxQuoteDiscountPct: z.number().min(0).max(50).default(5),
});

export const franchiseSchema = franchiseFields;
export type FranchiseDto = z.infer<typeof franchiseSchema>;

export const createFranchiseSchema = franchiseFields.extend({
  owner: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email('Enter the owner’s email'),
  }),
});
export type CreateFranchiseDto = z.infer<typeof createFranchiseSchema>;

const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Enter 6-digit pincodes');
export const territorySchema = z.object({
  add: z.array(pincode).max(1000).default([]),
  remove: z.array(pincode).max(1000).default([]),
  /** Take pincodes from other franchises. Without it, a clash is reported instead. */
  reassign: z.boolean().default(false),
});
export type TerritoryDto = z.infer<typeof territorySchema>;

export const technicianSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: indianMobileSchema,
  skills: z.array(z.string().trim().min(2).max(30)).max(10).default([]),
  isActive: z.boolean().default(true),
});
export type TechnicianDto = z.infer<typeof technicianSchema>;
