import { z } from 'zod';

const PRODUCT_TYPES = ['TEXT_NEON', 'LOGO_NEON', 'READYMADE', 'BUSINESS'] as const;
const code = z.string().regex(/^[A-Z0-9_]{2,30}$/, 'Use capitals, digits and underscores');
const rupeesInPaise = z.number().int().min(0).max(100_000_000);

export const rateEntriesSchema = z.object({
  notes: z.string().trim().max(500).nullable().default(null),
  entries: z
    .array(
      z.object({
        productType: z.enum(PRODUCT_TYPES),
        backboardCode: code,
        ratePerSqftPaise: z.number().int().min(100, 'Rates start at ₹1').max(10_000_000),
        minBillableSqft: z.number().min(0.25).max(50),
      }),
    )
    .max(200)
    .refine(
      (entries) => new Set(entries.map((e) => `${e.productType}:${e.backboardCode}`)).size === entries.length,
      'Each product and backboard pair can have only one rate',
    ),
});
export type RateEntriesDto = z.infer<typeof rateEntriesSchema>;

export const pricingRulesSchema = z.object({
  multiColorSurchargePct: z.number().min(0).max(100),
  gstRatePct: z.number().min(0).max(28),
  hsnCode: z.string().regex(/^\d{4,8}$/, 'HSN codes are 4 to 8 digits'),
  companyStateCode: z.string().regex(/^\d{2}$/),
  minOrderValuePaise: rupeesInPaise,
  maxQty: z.number().int().min(1).max(1000),
  advance: z.object({ thresholdPaise: rupeesInPaise, pct: z.number().min(1).max(100) }),
});
export type PricingRulesDto = z.infer<typeof pricingRulesSchema>;

export const addonsSchema = z.object({
  addons: z
    .array(
      z.object({
        code,
        name: z.string().trim().min(2).max(80),
        pricingType: z.enum(['FLAT', 'PER_SQFT', 'PERCENT']),
        /** Paise for FLAT and PER_SQFT, a percentage for PERCENT. */
        value: z.number().min(0).max(100_000_000),
        isActive: z.boolean(),
      }),
    )
    .max(50),
});
export type AddonsDto = z.infer<typeof addonsSchema>;

export const zoneSchema = z
  .object({
    code,
    name: z.string().trim().min(2).max(60),
    deliveryChargePaise: rupeesInPaise,
    freeDeliveryAbovePaise: rupeesInPaise.nullable(),
    installAvailable: z.boolean(),
    installType: z.enum(['FLAT', 'PER_SQFT']),
    installValuePaise: rupeesInPaise,
    deliveryDaysMin: z.number().int().min(1).max(60),
    deliveryDaysMax: z.number().int().min(1).max(60),
    isActive: z.boolean(),
  })
  .refine((zone) => zone.deliveryDaysMax >= zone.deliveryDaysMin, {
    path: ['deliveryDaysMax'],
    message: 'Must be at least the minimum',
  });
export type ZoneDto = z.infer<typeof zoneSchema>;

const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Enter 6-digit pincodes');
export const zonePincodesSchema = z.object({
  add: z.array(pincode).max(2000).default([]),
  remove: z.array(pincode).max(2000).default([]),
});
export type ZonePincodesDto = z.infer<typeof zonePincodesSchema>;

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,20}$/, '4 to 20 letters or digits'),
    type: z.enum(['PERCENT', 'FLAT']),
    /** A percentage for PERCENT, paise for FLAT. */
    value: z.number().positive().max(100_000_000),
    maxDiscountPaise: rupeesInPaise.nullable(),
    minOrderPaise: rupeesInPaise.nullable(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable(),
    usageLimit: z.number().int().min(1).nullable(),
    perUserLimit: z.number().int().min(1).nullable(),
    firstOrderOnly: z.boolean(),
    isActive: z.boolean(),
  })
  .superRefine((coupon, ctx) => {
    if (coupon.type === 'PERCENT' && coupon.value > 90) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Percentage coupons go up to 90%' });
    }
    if (coupon.endsAt && coupon.endsAt <= coupon.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must end after it starts' });
    }
  });
export type CouponDto = z.infer<typeof couponSchema>;
