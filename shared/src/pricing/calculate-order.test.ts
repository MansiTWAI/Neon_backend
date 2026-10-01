import { describe, expect, it } from 'vitest';
import { calculateOrder, calculatePrice } from './calculate-price';
import { sampleRules } from './sample-rules';
import type { LineInput, OrderPriceOk, Zone } from './types';

const pune: Zone = {
  code: 'PUNE_A',
  name: 'Pune city',
  deliveryChargePaise: 0,
  freeDeliveryAbovePaise: null,
  installAvailable: true,
  installType: 'PER_SQFT',
  installValuePaise: 12000,
  deliveryDaysMin: 5,
  deliveryDaysMax: 7,
};

const courier: Zone = {
  ...pune,
  code: 'REST_OF_INDIA',
  name: 'Rest of India',
  deliveryChargePaise: 19900,
  freeDeliveryAbovePaise: 300000,
  installAvailable: false,
};

const sign: LineInput = {
  productType: 'TEXT_NEON',
  backboardCode: 'CLR_CUT',
  widthIn: 24,
  heightIn: 11,
  colorCount: 1,
  addonCodes: [],
  qty: 1,
};

const ok = (result: ReturnType<typeof calculateOrder>) => {
  expect(result.status).toBe('OK');
  return result as OrderPriceOk;
};

describe('calculateOrder', () => {
  it('matches calculatePrice for a single sign', () => {
    const coupon = { code: 'NEON10', type: 'PERCENT' as const, value: 10, maxDiscountPaise: 50000 };
    const single = calculatePrice({ ...sign, qty: 2, installation: true, zone: pune, coupon }, sampleRules);
    const order = ok(
      calculateOrder({ lines: [{ ...sign, qty: 2 }], installation: true, zone: pune, coupon }, sampleRules),
    );

    expect(single.status).toBe('OK');
    if (single.status !== 'OK') return;
    expect(order.payablePaise).toBe(single.payablePaise);
    expect(order.installationPaise).toBe(single.installationPaise);
    expect(order.gst).toEqual(single.gst);
  });

  it('charges delivery once and applies free delivery on the order total', () => {
    const one = ok(calculateOrder({ lines: [sign], installation: false, zone: courier }, sampleRules));
    expect(one.deliveryPaise).toBe(19900);

    const two = ok(
      calculateOrder(
        { lines: [sign, { ...sign, widthIn: 36, heightIn: 18 }], installation: false, zone: courier },
        sampleRules,
      ),
    );
    expect(two.itemsPaise).toBeGreaterThanOrEqual(300000);
    expect(two.deliveryPaise).toBe(0);
  });

  it('splits installation across lines by area without losing a paisa', () => {
    const order = ok(
      calculateOrder(
        { lines: [sign, { ...sign, widthIn: 36, heightIn: 18, qty: 3 }], installation: true, zone: pune },
        sampleRules,
      ),
    );
    const shares = order.lines.map((line) => line.installationPaise);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(order.installationPaise);
    expect(shares[1]).toBeGreaterThan(shares[0]!);
  });

  it('charges a flat installation fee once per order', () => {
    const flat: Zone = { ...pune, installType: 'FLAT', installValuePaise: 150000 };
    const order = ok(calculateOrder({ lines: [sign, sign], installation: true, zone: flat }, sampleRules));
    expect(order.installationPaise).toBe(150000);
  });

  it('warns when installation is not offered at the address', () => {
    const order = ok(calculateOrder({ lines: [sign], installation: true, zone: courier }, sampleRules));
    expect(order.installationPaise).toBe(0);
    expect(order.warnings).toContain('INSTALLATION_NOT_AVAILABLE');
  });

  it('points at the line that needs a quotation', () => {
    const result = calculateOrder(
      { lines: [sign, { ...sign, backboardCode: 'PRINTED', productType: 'READYMADE' }], installation: false },
      sampleRules,
    );
    expect(result).toEqual({ status: 'QUOTE_REQUIRED', reason: 'NO_RATE', lineIndex: 1 });
  });

  it('applies the quantity limit to the whole order', () => {
    const result = calculateOrder(
      {
        lines: [
          { ...sign, qty: 15 },
          { ...sign, qty: 10 },
        ],
        installation: false,
      },
      sampleRules,
    );
    expect(result).toEqual({ status: 'QUOTE_REQUIRED', reason: 'MAX_QTY_EXCEEDED', lineIndex: null });
  });

  it('rejects an empty order', () => {
    expect(calculateOrder({ lines: [], installation: false }, sampleRules).status).toBe('INVALID');
  });
});
