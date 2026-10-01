import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, numericCode, safeEqual, sha256 } from './crypto';

describe('crypto helpers', () => {
  const key = randomBytes(32);

  it('round-trips through AES-GCM', () => {
    expect(decrypt(encrypt('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects ciphertext that was tampered with', () => {
    const sealed = encrypt('secret', key);
    sealed[sealed.length - 1]! ^= 1;
    expect(() => decrypt(sealed, key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decrypt(encrypt('secret', key), randomBytes(32))).toThrow();
  });

  it('produces fixed-length numeric codes', () => {
    expect(numericCode(6)).toMatch(/^\d{6}$/);
  });

  it('compares hashes without short-circuiting on length', () => {
    expect(safeEqual(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqual(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqual('short', 'longer value')).toBe(false);
  });
});
