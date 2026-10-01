import { describe, expect, it } from 'vitest';
import { indianMobileSchema, passwordLoginSchema, updateProfileSchema } from './auth.dto';

describe('indianMobileSchema', () => {
  it.each([
    ['9812345678', '+919812345678'],
    ['98123 45678', '+919812345678'],
    ['+91 98123-45678', '+919812345678'],
    ['919812345678', '+919812345678'],
  ])('normalises %s', (input, expected) => {
    expect(indianMobileSchema.parse(input)).toBe(expected);
  });

  it.each(['5812345678', '981234567', '98123456789', 'abcdefghij'])('rejects %s', (input) => {
    expect(indianMobileSchema.safeParse(input).success).toBe(false);
  });
});

describe('passwordLoginSchema', () => {
  it('normalises the email', () => {
    expect(passwordLoginSchema.parse({ email: '  Admin@NeonAdda.test ', password: 'x' }).email).toBe(
      'admin@neonadda.test',
    );
  });
});

describe('updateProfileSchema', () => {
  it('accepts names with Indian scripts and common punctuation', () => {
    expect(updateProfileSchema.safeParse({ name: "Riya D'Souza" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: 'रिया शर्मा' }).success).toBe(true);
  });

  it('rejects digits in names', () => {
    expect(updateProfileSchema.safeParse({ name: 'Riya123' }).success).toBe(false);
  });
});
