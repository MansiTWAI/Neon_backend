import { describe, expect, it } from 'vitest';
import { calculatePriceSchema, pincodeSchema } from './pricing.dto';

describe('calculatePriceSchema', () => {
  it('fills in defaults for optional fields', () => {
    const dto = calculatePriceSchema.parse({ backboardCode: 'CLR_CUT', widthIn: 24, heightIn: 11 });
    expect(dto).toMatchObject({ colorCount: 1, addonCodes: [], qty: 1, installation: false });
  });

  it('reports every invalid field at once', () => {
    const result = calculatePriceSchema.safeParse({
      backboardCode: 'CLR_CUT',
      widthIn: -1,
      heightIn: 10,
      pincode: '012345',
      couponCode: 'X!',
    });

    expect(result.success).toBe(false);
    const fields = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['widthIn', 'pincode', 'couponCode']));
  });

  it('accepts a complete request', () => {
    const result = calculatePriceSchema.safeParse({
      productType: 'TEXT_NEON',
      backboardCode: 'CLR_CUT',
      widthIn: 36,
      heightIn: 18,
      colorCount: 2,
      addonCodes: ['DIMMER'],
      qty: 1,
      installation: true,
      pincode: '411001',
      couponCode: 'NEON10',
      billingStateCode: '27',
    });
    expect(result.success).toBe(true);
  });
});

describe('pincodeSchema', () => {
  it.each(['411001', '560001'])('accepts %s', (pincode) => {
    expect(pincodeSchema.safeParse(pincode).success).toBe(true);
  });

  it.each(['011001', '41100', 'ABCDEF'])('rejects %s', (pincode) => {
    expect(pincodeSchema.safeParse(pincode).success).toBe(false);
  });
});
