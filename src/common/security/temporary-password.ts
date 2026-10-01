import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: these are read aloud over the phone and typed by hand.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** A one-time password for a new account, e.g. "Kpmw-7rTq-4hXe". Shown once and never stored in plain text. */
export function temporaryPassword(): string {
  const group = () =>
    Array.from({ length: 4 }, (_, i) =>
      i === 1 ? DIGITS[randomInt(DIGITS.length)] : LETTERS[randomInt(LETTERS.length)],
    ).join('');
  return [group(), group(), group()].join('-');
}
