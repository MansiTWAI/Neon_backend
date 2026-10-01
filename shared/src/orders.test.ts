import { describe, expect, it } from 'vitest';
import { isValidGstin } from './gst-states';
import { canStaffMove, currentStageIndex, orderStages } from './orders';

describe('order stages', () => {
  it('adds the installation step only when it was booked', () => {
    expect(orderStages(false)).not.toContain('INSTALLED');
    expect(orderStages(true).at(-1)).toBe('INSTALLED');
  });

  it('maps statuses onto the customer-facing steps', () => {
    expect(currentStageIndex('PENDING_PAYMENT', false)).toBe(0);
    expect(currentStageIndex('QUALITY_CHECK', false)).toBe(3);
    expect(currentStageIndex('COMPLETED', false)).toBe(5);
    expect(currentStageIndex('COMPLETED', true)).toBe(6);
    expect(currentStageIndex('CANCELLED', true)).toBe(-1);
  });
});

describe('isValidGstin', () => {
  it.each(['27AAPFU0939F1ZV', '29ABCDE1234F1Z5'])('accepts %s', (gstin) => {
    expect(isValidGstin(gstin)).toBe(true);
  });

  it.each(['99AAPFU0939F1ZV', '27aapfu0939f1zv', '27AAPFU0939F1Z', '27AAPFU0939F0ZV'])(
    'rejects %s',
    (gstin) => {
      expect(isValidGstin(gstin)).toBe(false);
    },
  );
});

describe('canStaffMove', () => {
  it('follows the production line', () => {
    expect(canStaffMove('PROOF_APPROVED', 'IN_PRODUCTION')).toBe(true);
    expect(canStaffMove('QUALITY_CHECK', 'IN_PRODUCTION')).toBe(true);
  });

  it('never skips payment or the customer’s proof approval', () => {
    expect(canStaffMove('PENDING_PAYMENT', 'CONFIRMED')).toBe(false);
    expect(canStaffMove('PROOF_PENDING', 'PROOF_APPROVED')).toBe(false);
    expect(canStaffMove('CONFIRMED', 'IN_PRODUCTION')).toBe(false);
  });

  it('does not reopen closed orders', () => {
    expect(canStaffMove('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canStaffMove('COMPLETED', 'DELIVERED')).toBe(false);
  });
});
