import type { PricingRules } from './types';

/**
 * Launch rate card used by the database seed, the test suite and the storefront's offline fallback.
 * Production values live in the rate card tables and are edited from the admin panel.
 */
export const sampleRules: PricingRules = {
  rateCardVersion: 1,
  rates: [
    { productType: 'TEXT_NEON', backboardCode: 'CLR_CUT', ratePerSqftPaise: 85000, minBillableSqft: 1.5 },
    { productType: 'TEXT_NEON', backboardCode: 'CLR_RECT', ratePerSqftPaise: 80000, minBillableSqft: 1.5 },
    { productType: 'TEXT_NEON', backboardCode: 'BLK_ACR', ratePerSqftPaise: 90000, minBillableSqft: 1.5 },
    { productType: 'TEXT_NEON', backboardCode: 'PRINTED', ratePerSqftPaise: 105000, minBillableSqft: 2 },
    { productType: 'LOGO_NEON', backboardCode: 'CLR_CUT', ratePerSqftPaise: 110000, minBillableSqft: 1.5 },
    { productType: 'LOGO_NEON', backboardCode: 'CLR_RECT', ratePerSqftPaise: 105000, minBillableSqft: 1.5 },
    { productType: 'LOGO_NEON', backboardCode: 'BLK_ACR', ratePerSqftPaise: 115000, minBillableSqft: 1.5 },
    { productType: 'LOGO_NEON', backboardCode: 'PRINTED', ratePerSqftPaise: 130000, minBillableSqft: 2 },
    { productType: 'READYMADE', backboardCode: 'CLR_CUT', ratePerSqftPaise: 80000, minBillableSqft: 1.5 },
    { productType: 'READYMADE', backboardCode: 'CLR_RECT', ratePerSqftPaise: 76000, minBillableSqft: 1.5 },
    { productType: 'READYMADE', backboardCode: 'BLK_ACR', ratePerSqftPaise: 85000, minBillableSqft: 1.5 },
  ],
  addons: [
    { code: 'DIMMER', name: 'Dimmer with remote', pricingType: 'FLAT', value: 49900 },
    { code: 'WATERPROOF', name: 'Outdoor waterproofing (IP65)', pricingType: 'PER_SQFT', value: 15000 },
    { code: 'HANGING_KIT', name: 'Hanging chain kit', pricingType: 'FLAT', value: 19900 },
    { code: 'EXTRA_CABLE', name: 'Extra 3 m power cable', pricingType: 'FLAT', value: 14900 },
  ],
  multiColorSurchargePct: 10,
  gstRatePct: 18,
  hsnCode: '9405',
  companyStateCode: '27',
  minOrderValuePaise: 199900,
  maxQty: 20,
  advance: { thresholdPaise: 1500000, pct: 50 },
};
