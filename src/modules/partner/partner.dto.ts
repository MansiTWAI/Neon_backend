import { z } from 'zod';
import { pageSchema, searchSchema } from '../../common/http/pagination';

export const PARTNER_ORDER_QUEUES = ['open', 'installation', 'cash-to-collect', 'closed', 'all'] as const;

export const partnerOrderListSchema = pageSchema.extend({
  queue: z.enum(PARTNER_ORDER_QUEUES).default('open').catch('open'),
  q: searchSchema,
});
export type PartnerOrderListQuery = z.infer<typeof partnerOrderListSchema>;

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
