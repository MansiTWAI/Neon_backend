import { describe, expect, it } from 'vitest';
import { resolveCommission, type CommissionOrder, type CommissionRule } from './resolve-commission';

const rule = (r: Partial<CommissionRule> & Pick<CommissionRule, 'id'>): CommissionRule => ({
  scope: 'DEFAULT',
  source: 'ANY',
  type: 'PERCENT',
  value: 10,
  priority: 0,
  effectiveFrom: '2026-01-01',
  isActive: true,
  ...r,
});

const rules: CommissionRule[] = [
  rule({ id: 'default-self', source: 'SELF_SOURCED', value: 12 }),
  rule({ id: 'default-assigned', source: 'ASSIGNED', value: 6 }),
  rule({ id: 'gold-self', scope: 'TIER', tierId: 'gold', source: 'SELF_SOURCED', value: 15 }),
  rule({
    id: 'pune-logo-flat',
    scope: 'FRANCHISE',
    franchiseId: 'pune',
    categoryId: 'logo',
    type: 'FLAT',
    value: 75000,
  }),
];

const order = (o: Partial<CommissionOrder>): CommissionOrder => ({
  franchiseId: 'pune',
  tierId: 'gold',
  source: 'SELF_SOURCED',
  paidAt: '2026-10-20',
  lines: [{ categoryId: 'text', taxablePaise: 474650, installationPaise: 54000 }],
  ...o,
});

describe('resolveCommission', () => {
  it('applies the tier rate to the taxable value net of installation', () => {
    const r = resolveCommission(order({}), rules)!;
    expect(r.appliedRuleIds).toEqual(['gold-self']);
    expect(r.basePaise).toBe(420650);
    expect(r.amountPaise).toBe(63098);
  });

  it('most specific rule wins: franchise + category flat beats tier %', () => {
    const r = resolveCommission(
      order({ lines: [{ categoryId: 'logo', taxablePaise: 900000, installationPaise: 0 }] }),
      rules,
    )!;
    expect(r.appliedRuleIds).toEqual(['pune-logo-flat']);
    expect(r.amountPaise).toBe(75000);
  });

  it('assigned orders use the assigned rate', () => {
    const r = resolveCommission(order({ tierId: 'silver', source: 'ASSIGNED' }), rules)!;
    expect(r.appliedRuleIds).toEqual(['default-assigned']);
    expect(r.amountPaise).toBe(25239); // 6% of 420650 = 25239
  });

  it('flat rules are applied once per order across lines', () => {
    const r = resolveCommission(
      order({
        lines: [
          { categoryId: 'logo', taxablePaise: 500000, installationPaise: 0 },
          { categoryId: 'logo', taxablePaise: 300000, installationPaise: 0 },
        ],
      }),
      rules,
    )!;
    expect(r.amountPaise).toBe(75000);
  });

  it('respects effective dates, inactive rules and per-order caps', () => {
    const dated = [
      rule({ id: 'old', value: 20, effectiveTo: '2026-06-30' }),
      rule({ id: 'off', value: 30, isActive: false }),
      rule({ id: 'future', value: 25, effectiveFrom: '2027-01-01' }),
      rule({ id: 'capped', value: 50, maxPerOrderPaise: 10000 }),
    ];
    const r = resolveCommission(order({ tierId: null }), dated)!;
    expect(r.appliedRuleIds).toEqual(['capped']);
    expect(r.amountPaise).toBe(10000);
  });

  it('can include installation in the base when the setting is on', () => {
    const r = resolveCommission(order({ includeInstallation: true }), rules)!;
    expect(r.basePaise).toBe(474650);
  });

  it('returns null when no rule matches', () => {
    expect(
      resolveCommission(order({}), [rule({ id: 'x', scope: 'FRANCHISE', franchiseId: 'other' })]),
    ).toBeNull();
  });
});
