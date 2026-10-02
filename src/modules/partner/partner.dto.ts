import { z } from 'zod';
import { pageSchema, searchSchema } from '../../common/http/pagination';
import { indianMobileSchema } from '../auth/auth.dto';

export const PARTNER_ORDER_QUEUES = ['open', 'installation', 'cash-to-collect', 'closed', 'all'] as const;

export const partnerOrderListSchema = pageSchema.extend({
  queue: z.enum(PARTNER_ORDER_QUEUES).default('open').catch('open'),
  q: searchSchema,
});
export type PartnerOrderListQuery = z.infer<typeof partnerOrderListSchema>;

export const partnerInstallationSchema = z
  .object({
    technicianId: z.string().uuid().nullable(),
    scheduledStart: z.coerce.date().nullable(),
    durationHours: z.number().min(0.5).max(12).default(2),
    notes: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .refine((dto) => !dto.technicianId || dto.scheduledStart, {
    path: ['scheduledStart'],
    message: 'Pick a date and time for the technician',
  });
export type PartnerInstallationDto = z.infer<typeof partnerInstallationSchema>;

export const partnerTechnicianSchema = z.object({
  name: z.string().trim().min(2, 'Enter the technician’s name').max(80),
  phone: indianMobileSchema,
  isActive: z.boolean().default(true),
});
export type PartnerTechnicianDto = z.infer<typeof partnerTechnicianSchema>;

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'] as const;

export const partnerLeadListSchema = pageSchema.extend({
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
});
export type PartnerLeadListQuery = z.infer<typeof partnerLeadListSchema>;

export const partnerLeadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  followUpAt: z.coerce.date().nullable().optional(),
});
export type PartnerLeadUpdateDto = z.infer<typeof partnerLeadUpdateSchema>;
