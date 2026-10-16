import { z } from 'zod';
import { pageSchema, searchSchema } from '../../../common/http/pagination';
import { indianMobileSchema } from '../../auth/auth.dto';

const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Pincodes have 6 digits');

export const technicianDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(80),
  phone: indianMobileSchema,
  skills: z.array(z.string().trim().toLowerCase().min(2).max(30)).max(10).default([]),
  serviceCity: z.string().trim().max(80).nullable().default(null),
  servicePincodes: z.array(pincode).max(200).default([]),
  /** The franchise they usually work with, if any. Assignment is by the admin team either way. */
  franchiseId: z.string().uuid().nullable().default(null),
});
export type TechnicianDetailsDto = z.infer<typeof technicianDetailsSchema>;

export const createTechnicianSchema = technicianDetailsSchema.extend({
  /** Approve straight away, for someone the team has already vetted. */
  approve: z.boolean().default(false),
});
export type CreateTechnicianDto = z.infer<typeof createTechnicianSchema>;

export const technicianListSchema = pageSchema.extend({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional().catch(undefined),
  q: searchSchema,
});
export type TechnicianListQuery = z.infer<typeof technicianListSchema>;

export const suspendTechnicianSchema = z.object({
  reason: z.string().trim().min(5, 'Say why, for the record').max(500),
});
export type SuspendTechnicianDto = z.infer<typeof suspendTechnicianSchema>;

export const candidatesQuerySchema = z.object({
  start: z.coerce.date().optional().catch(undefined),
  durationHours: z.coerce.number().min(0.5).max(12).default(2).catch(2),
});
export type CandidatesQuery = z.infer<typeof candidatesQuerySchema>;
