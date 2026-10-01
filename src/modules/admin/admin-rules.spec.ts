import { describe, expect, it } from 'vitest';
import { temporaryPassword } from '../../common/security/temporary-password';
import { commissionRuleSchema } from './commission/admin-commission.dto';
import { statusChangeSchema } from './orders/admin-orders.dto';
import { financialYearOf } from './orders/order-workflow.service';
import { couponSchema, rateEntriesSchema } from './pricing/admin-pricing.dto';

describe('financialYearOf', () => {
  it('runs April to March in Indian time', () => {
    expect(financialYearOf(new Date('2026-09-30T10:00:00Z'))).toBe('2026-27');
    expect(financialYearOf(new Date('2027-03-31T10:00:00Z'))).toBe('2026-27');
    // 31 March 23:00 UTC is already 1 April in India.
    expect(financialYearOf(new Date('2027-03-31T19:00:00Z'))).toBe('2027-28');
    expect(financialYearOf(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });
});

describe('temporaryPassword', () => {
  it('avoids characters that are easy to misread', () => {
    for (let i = 0; i < 200; i++) {
      const password = temporaryPassword();
      expect(password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(password).not.toMatch(/[01OlI]/);
    }
  });
});

describe('statusChangeSchema', () => {
  it('needs courier details to ship', () => {
    expect(statusChangeSchema.safeParse({ to: 'SHIPPED' }).success).toBe(false);
    expect(
      statusChangeSchema.safeParse({ to: 'SHIPPED', courierName: 'Delhivery', awbNo: '1234567890' }).success,
    ).toBe(true);
  });

  it('needs a reason to hold or cancel', () => {
    expect(statusChangeSchema.safeParse({ to: 'ON_HOLD', note: '  ' }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ to: 'CANCELLED', note: 'Customer asked' }).success).toBe(true);
  });
});

describe('commissionRuleSchema', () => {
  const base = { source: 'ANY', type: 'PERCENT', value: 10, effectiveFrom: '2026-10-01' };

  it('requires the tier or franchise the rule is scoped to', () => {
    expect(commissionRuleSchema.safeParse({ ...base, scope: 'TIER' }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ ...base, scope: 'FRANCHISE' }).success).toBe(false);
  });

  it('drops ids that do not match the scope', () => {
    const rule = commissionRuleSchema.parse({
      ...base,
      scope: 'DEFAULT',
      tierId: '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7b',
    });
    expect(rule.tierId).toBeNull();
  });

  it('caps percentage rules', () => {
    expect(commissionRuleSchema.safeParse({ ...base, scope: 'DEFAULT', value: 60 }).success).toBe(false);
  });
});

describe('rateEntriesSchema', () => {
  it('rejects two rates for the same product and backboard', () => {
    const entry = {
      productType: 'TEXT_NEON',
      backboardCode: 'CLR_CUT',
      ratePerSqftPaise: 85000,
      minBillableSqft: 1.5,
    };
    expect(rateEntriesSchema.safeParse({ entries: [entry, entry] }).success).toBe(false);
    expect(rateEntriesSchema.safeParse({ entries: [entry] }).success).toBe(true);
  });
});

describe('couponSchema', () => {
  const coupon = {
    code: 'diwali25',
    type: 'PERCENT',
    value: 25,
    maxDiscountPaise: 100000,
    minOrderPaise: null,
    startsAt: '2026-10-15',
    endsAt: '2026-11-05',
    usageLimit: null,
    perUserLimit: 1,
    firstOrderOnly: false,
    isActive: true,
  };

  it('upper-cases the code', () => {
    expect(couponSchema.parse(coupon).code).toBe('DIWALI25');
  });

  it('rejects an end date before the start', () => {
    expect(couponSchema.safeParse({ ...coupon, endsAt: '2026-10-01' }).success).toBe(false);
  });
});
