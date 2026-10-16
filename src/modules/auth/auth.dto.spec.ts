import { describe, expect, it } from 'vitest';
import {
  customerLoginSchema,
  indianMobileSchema,
  passwordLoginSchema,
  registerSchema,
  updateProfileSchema,
} from './auth.dto';

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

describe('customerLoginSchema', () => {
  it('reads an email or a mobile number', () => {
    expect(customerLoginSchema.parse({ login: ' Riya@Example.com ', password: 'x' }).login).toEqual({
      email: 'riya@example.com',
    });
    expect(customerLoginSchema.parse({ login: '98123 45678', password: 'x' }).login).toEqual({
      phone: '+919812345678',
    });
  });

  it('rejects anything else', () => {
    expect(customerLoginSchema.safeParse({ login: 'riya', password: 'x' }).success).toBe(false);
    expect(customerLoginSchema.safeParse({ login: 'riya@', password: 'x' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = {
    name: 'Riya Sharma',
    email: 'riya@example.com',
    phone: '9812345678',
    password: 'long enough',
  };

  it('accepts complete details', () => {
    expect(registerSchema.parse(valid).phone).toBe('+919812345678');
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a password of spaces', { password: '          ' }],
    ['a missing email', { email: '' }],
    ['a bad number', { phone: '12345' }],
  ])('rejects %s', (_label, change) => {
    expect(registerSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
