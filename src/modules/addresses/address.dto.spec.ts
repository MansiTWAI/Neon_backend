import { describe, expect, it } from 'vitest';
import { addressSchema } from './address.dto';

const address = {
  name: 'Riya Sharma',
  phone: '98123 45678',
  line1: 'Flat 4B, Sunshine Apartments',
  city: 'Pune',
  stateCode: '27',
  pincode: '411004',
};

const fieldsOf = (input: unknown) => {
  const result = addressSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('addressSchema', () => {
  it('normalises the phone and blanks optional fields', () => {
    const parsed = addressSchema.parse({ ...address, line2: '  ', gstin: '' });
    expect(parsed).toMatchObject({ phone: '+919812345678', line2: null, gstin: null, isDefault: false });
  });

  it('rejects an unknown state code', () => {
    expect(fieldsOf({ ...address, stateCode: '99' })).toContain('stateCode');
  });

  it('upper-cases a GSTIN and requires the business name with it', () => {
    expect(fieldsOf({ ...address, gstin: '27aapfu0939f1zv' })).toEqual(['businessName']);
    const parsed = addressSchema.parse({ ...address, gstin: '27aapfu0939f1zv', businessName: 'Chai Point' });
    expect(parsed.gstin).toBe('27AAPFU0939F1ZV');
  });

  it('rejects a GSTIN registered in another state', () => {
    expect(fieldsOf({ ...address, gstin: '29ABCDE1234F1Z5', businessName: 'Chai Point' })).toContain('gstin');
  });
});
