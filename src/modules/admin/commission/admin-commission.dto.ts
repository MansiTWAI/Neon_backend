import { z } from 'zod';
import { pageSchema } from '../../../common/http/pagination';

export const commissionRuleSchema = z
  .object({
    scope: z.enum(['DEFAULT', 'TIER', 'FRANCHISE']),
    tierId: z.string().uuid().nullable().default(null),
    franchiseId: z.string().uuid().nullable().default(null),
    categoryId: z.string().uuid().nullable().default(null),
    source: z.enum(['SELF_SOURCED', 'ASSIGNED', 'ANY']),
    type: z.enum(['PERCENT', 'FLAT']),
    /** A percentage for PERCENT, paise for FLAT. */
    value: z.number().positive().max(100_000_000),
    maxPerOrderPaise: z.number().int().positive().nullable().default(null),
    priority: z.number().int().min(-50).max(50).default(0),
    effectiveFrom: z.coerce.date(),
  })
  .superRefine((rule, ctx) => {
    if (rule.scope === 'TIER' && !rule.tierId)
      ctx.addIssue({ code: 'custom', path: ['tierId'], message: 'Choose a tier' });
    if (rule.scope === 'FRANCHISE' && !rule.franchiseId) {
      ctx.addIssue({ code: 'custom', path: ['franchiseId'], message: 'Choose a franchise' });
    }
    if (rule.type === 'PERCENT' && rule.value > 50) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Percentage rules go up to 50%' });
    }
  })
  .transform((rule) => ({
    ...rule,
    tierId: rule.scope === 'TIER' ? rule.tierId : null,
    franchiseId: rule.scope === 'FRANCHISE' ? rule.franchiseId : null,
  }));
export type CommissionRuleDto = z.infer<typeof commissionRuleSchema>;

export const LEDGER_STATUSES = ['PENDING', 'ELIGIBLE', 'APPROVED', 'PAID', 'REVERSED', 'ON_HOLD'] as const;

export const ledgerQuerySchema = pageSchema.extend({
  status: z.enum(LEDGER_STATUSES).optional().catch(undefined),
  franchiseId: z.string().uuid().optional().catch(undefined),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const commissionIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

export const createPayoutSchema = z.object({ franchiseId: z.string().uuid() });

export const markPaidSchema = z.object({
  utr: z.string().trim().min(6, 'Enter the bank reference (UTR)').max(40),
  mode: z.enum(['NEFT', 'IMPS', 'RTGS', 'UPI']),
});
export type MarkPaidDto = z.infer<typeof markPaidSchema>;

export const commissionSettingsSchema = z.object({
  eligibilityDays: z.number().int().min(0).max(90),
  includeInstallation: z.boolean(),
  tdsPct: z.number().min(0).max(20),
});
export type CommissionSettingsDto = z.infer<typeof commissionSettingsSchema>;
