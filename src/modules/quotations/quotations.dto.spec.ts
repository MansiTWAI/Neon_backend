import { describe, expect, it } from 'vitest';
import { requestQuoteSchema } from './quotations.dto';

const logoDesign = {
  productId: '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7b',
  config: {
    mode: 'LOGO',
    uploadId: '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7c',
    colorName: 'Ice Blue',
    glowHex: '#22D3EE',
    tubeHex: '#DDF8FF',
  },
  widthIn: 30,
  heightIn: 18,
  backboardCode: 'BLK_ACR',
};

const fieldsOf = (input: unknown) => {
  const result = requestQuoteSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('requestQuoteSchema', () => {
  it('accepts a logo request', () => {
    expect(fieldsOf({ kind: 'LOGO', design: logoDesign, pincode: '411004' })).toEqual([]);
  });

  it('requires an uploaded logo for a logo quote', () => {
    expect(fieldsOf({ kind: 'LOGO', pincode: '411004', message: 'Our café logo' })).toContain('design');
  });

  it('needs either a design or a description', () => {
    expect(fieldsOf({ kind: 'CUSTOM', pincode: '411004' })).toContain('message');
    expect(fieldsOf({ kind: 'CUSTOM', pincode: '411004', message: 'A 10 ft shop front sign' })).toEqual([]);
  });
});
