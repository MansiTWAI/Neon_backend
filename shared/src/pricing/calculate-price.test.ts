import { describe, expect, it } from 'vitest';
import { calculatePrice } from './calculate-price';
import { sampleRules } from './sample-rules';
import type { PriceInput, PriceOk, Zone } from './types';

const zoneA: Zone = {
  code: 'PUNE_A',
  name: 'Zone A',
  deliveryChargePaise: 0,
  freeDeliveryAbovePaise: null,
  installAvailable: true,
  installType: 'PER_SQFT',
  installValuePaise: 12000,
  deliveryDaysMin: 5,
  deliveryDaysMax: 7,
};

const base: PriceInput = {
  productType: 'TEXT_NEON',
  backboardCode: 'CLR_CUT',
  widthIn: 36,
  heightIn: 18,
  colorCount: 1,
  addonCodes: [],
  qty: 1,
  installation: false,
};

const ok = (input: PriceInput) => {
  const r = calculatePrice(input, sampleRules);
  expect(r.status).toBe('OK');
  return r as PriceOk;
};

describe('calculatePrice', () => {
  it('prices a two-colour sign with dimmer, installation and a capped coupon', () => {
    const r = ok({
      ...base,
      colorCount: 2,
      addonCodes: ['DIMMER'],
      installation: true,
      zone: zoneA,
      coupon: { code: 'NEON10', type: 'PERCENT', value: 10, maxDiscountPaise: 50000 },
    });
    expect(r.areaSqft).toBe(4.5);
    expect(r.breakup.find((b) => b.code === 'BASE')?.amountPaise).toBe(382500);
    expect(r.breakup.find((b) => b.code === 'MULTICOLOR')?.amountPaise).toBe(38250);
    expect(r.installationPaise).toBe(54000);
    expect(r.discountPaise).toBe(50000);
    expect(r.taxablePaise).toBe(474650);
    // CGST and SGST each rounded: 42718.5 → 42719
    expect(r.gst).toMatchObject({ type: 'INTRA', cgstPaise: 42719, sgstPaise: 42719, igstPaise: 0 });
    expect(r.payablePaise).toBe(560100);
  });

  it('rounds the payable amount to the rupee and reports the round-off', () => {
    const r = ok({
      ...base,
      addonCodes: ['DIMMER'],
      installation: true,
      zone: zoneA,
      coupon: { code: 'NEON10', type: 'PERCENT', value: 10, maxDiscountPaise: 50000 },
    });
    expect(r.discountPaise).toBe(48640);
    expect(r.taxablePaise).toBe(437760);
    expect(r.gst.cgstPaise).toBe(39398);
    expect(r.totalPaise).toBe(516556);
    expect(r.roundOffPaise).toBe(44);
    expect(r.payablePaise).toBe(516600);
  });

  it('rounds area up to the next hundredth of a square foot', () => {
    const r = ok({ ...base, widthIn: 24, heightIn: 11 });
    expect(r.areaSqft).toBe(1.84);
    expect(r.breakup[0]?.amountPaise).toBe(156400); // 1.84 × ₹850
  });

  it('charges the minimum billable area for tiny signs', () => {
    const r = ok({ ...base, widthIn: 12, heightIn: 6 }); // 0.5 sq ft → billed 1.5
    expect(r.areaSqft).toBe(0.5);
    expect(r.billableSqft).toBe(1.5);
    expect(r.breakup[0]?.amountPaise).toBe(127500);
    expect(r.warnings).toContain('BELOW_MIN_ORDER_VALUE');
  });

  it('uses IGST for a different billing state', () => {
    const r = ok({ ...base, billingStateCode: '29' });
    expect(r.gst.type).toBe('INTER');
    expect(r.gst.igstPaise).toBe(roundGst(r.taxablePaise, 18));
    expect(r.gst.cgstPaise + r.gst.sgstPaise).toBe(0);
  });

  it('applies PER_SQFT add-ons on billable area and multiplies by quantity', () => {
    const r = ok({ ...base, addonCodes: ['WATERPROOF'], qty: 3 });
    expect(r.unitPricePaise).toBe(382500 + 67500);
    expect(r.itemsPaise).toBe((382500 + 67500) * 3);
  });

  it('warns and skips installation outside serviceable zones', () => {
    const r = ok({ ...base, installation: true, zone: { ...zoneA, installAvailable: false } });
    expect(r.installationPaise).toBe(0);
    expect(r.warnings).toContain('INSTALLATION_NOT_AVAILABLE');
  });

  it('ignores coupon when below its minimum order', () => {
    const r = ok({ ...base, coupon: { code: 'BIG', type: 'FLAT', value: 100000, minOrderPaise: 1000000 } });
    expect(r.discountPaise).toBe(0);
    expect(r.warnings).toContain('COUPON_MIN_ORDER_NOT_MET');
  });

  it('waives delivery above the free-delivery threshold', () => {
    const zone = { ...zoneA, deliveryChargePaise: 19900, freeDeliveryAbovePaise: 300000 };
    expect(ok({ ...base, zone }).deliveryPaise).toBe(0); // ₹3,825 ≥ ₹3,000
    expect(ok({ ...base, widthIn: 20, heightIn: 10, zone }).deliveryPaise).toBe(19900);
  });

  it('offers advance payment above the threshold', () => {
    const r = ok({ ...base, widthIn: 72, heightIn: 36 }); // 18 sq ft × ₹850 = ₹15,300 + GST
    expect(r.advance.eligible).toBe(true);
    expect(r.advance.amountPaise).toBe(r.payablePaise / 2);
    expect(ok(base).advance).toEqual({ eligible: false, amountPaise: ok(base).payablePaise });
  });

  it('uses the product rate override for ready-made designs', () => {
    const r = ok({ ...base, productType: 'READYMADE', rateOverridePaise: 70000 });
    expect(r.ratePerSqftPaise).toBe(70000);
  });

  it('switches to quotation when size or qty exceed limits, or no rate exists', () => {
    const sizeLimits = { minWidthIn: 12, maxWidthIn: 96, minHeightIn: 4, maxHeightIn: 60 };
    expect(calculatePrice({ ...base, widthIn: 120, sizeLimits }, sampleRules)).toMatchObject({
      status: 'QUOTE_REQUIRED',
      reason: 'MAX_WIDTH_EXCEEDED',
    });
    expect(calculatePrice({ ...base, qty: 21 }, sampleRules)).toMatchObject({ reason: 'MAX_QTY_EXCEEDED' });
    expect(calculatePrice({ ...base, productType: 'BUSINESS' }, sampleRules)).toMatchObject({
      reason: 'NO_RATE',
    });
    expect(calculatePrice({ ...base, widthIn: 8, sizeLimits }, sampleRules)).toMatchObject({
      status: 'INVALID',
      reason: 'MIN_WIDTH',
    });
  });

  it('rejects non-positive dimensions and fractional quantities', () => {
    expect(calculatePrice({ ...base, widthIn: 0 }, sampleRules).status).toBe('INVALID');
    expect(calculatePrice({ ...base, qty: 1.5 }, sampleRules).status).toBe('INVALID');
  });
});

function roundGst(taxable: number, pct: number) {
  return Math.floor((taxable * pct) / 100 + 0.5);
}
