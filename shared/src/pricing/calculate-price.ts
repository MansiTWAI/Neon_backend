import { areaHundredths, formatINR, roundHalfUp } from '../money';
import type {
  BreakupLine,
  Coupon,
  LineInput,
  OrderInput,
  OrderLinePrice,
  OrderPriceResult,
  PriceInput,
  PriceResult,
  PriceWarning,
  PricingRules,
  Zone,
} from './types';

/**
 * Prices a sign from the admin's per-sq-ft rate card.
 *
 * base → multi-colour surcharge → add-ons → × qty → installation → delivery → coupon → GST
 *
 * The coupon applies to goods and installation but not delivery. CGST and SGST are rounded
 * individually, matching how they are printed on the tax invoice.
 */
export function calculatePrice(input: PriceInput, rules: PricingRules): PriceResult {
  const line = priceLine(input, rules);
  if (line.status !== 'OK') return line;

  const warnings = [...line.warnings];
  const breakup = [...line.breakup];
  const zone = input.zone ?? null;

  let installation = 0;
  if (input.installation) {
    if (zone?.installAvailable) {
      installation = installationCharge(zone, line.billableH * line.qty);
      breakup.push({ code: 'INSTALLATION', label: `Installation (${zone.name})`, amountPaise: installation });
    } else {
      warnings.push('INSTALLATION_NOT_AVAILABLE');
    }
  }

  const totals = settle(
    {
      items: line.itemsPaise,
      installation,
      zone,
      coupon: input.coupon ?? null,
      billingStateCode: input.billingStateCode,
    },
    rules,
  );

  return {
    status: 'OK',
    rateCardVersion: rules.rateCardVersion,
    areaSqft: line.areaSqft,
    billableSqft: line.billableSqft,
    ratePerSqftPaise: line.ratePerSqftPaise,
    unitPricePaise: line.unitPricePaise,
    qty: line.qty,
    breakup: [...breakup, ...totals.breakup],
    itemsPaise: line.itemsPaise,
    installationPaise: installation,
    ...totals.amounts,
    warnings: [...warnings, ...totals.warnings],
  };
}

/**
 * Prices a whole cart. Each sign is priced on its own; installation is charged per sign
 * (or once, for a flat-rate zone), and delivery, the coupon and GST apply to the order.
 */
export function calculateOrder(input: OrderInput, rules: PricingRules): OrderPriceResult {
  if (input.lines.length === 0) return { status: 'INVALID', reason: 'EMPTY', lineIndex: null };

  const zone = input.zone ?? null;
  const warnings: PriceWarning[] = [];
  const lines: OrderLinePrice[] = [];
  let totalQty = 0;
  let installableH = 0;

  for (const [lineIndex, lineInput] of input.lines.entries()) {
    const line = priceLine(lineInput, rules);
    if (line.status === 'INVALID') return { status: 'INVALID', reason: line.reason, lineIndex };
    if (line.status === 'QUOTE_REQUIRED') return { status: 'QUOTE_REQUIRED', reason: line.reason, lineIndex };

    warnings.push(...line.warnings);
    totalQty += line.qty;
    installableH += line.billableH * line.qty;
    lines.push({
      areaSqft: line.areaSqft,
      billableSqft: line.billableSqft,
      ratePerSqftPaise: line.ratePerSqftPaise,
      unitPricePaise: line.unitPricePaise,
      qty: line.qty,
      itemsPaise: line.itemsPaise,
      installationPaise: 0,
      breakup: line.breakup,
    });
  }
  if (totalQty > rules.maxQty)
    return { status: 'QUOTE_REQUIRED', reason: 'MAX_QTY_EXCEEDED', lineIndex: null };

  let installation = 0;
  if (input.installation) {
    if (zone?.installAvailable) {
      installation = installationCharge(zone, installableH);
      // Spread across lines by area so each order item carries its own share.
      let assigned = 0;
      lines.forEach((line, i) => {
        const share =
          i === lines.length - 1
            ? installation - assigned
            : roundHalfUp((installation * line.billableSqft * line.qty * 100) / installableH);
        line.installationPaise = share;
        assigned += share;
      });
    } else {
      warnings.push('INSTALLATION_NOT_AVAILABLE');
    }
  }

  const itemsPaise = lines.reduce((sum, line) => sum + line.itemsPaise, 0);
  const totals = settle(
    {
      items: itemsPaise,
      installation,
      zone,
      coupon: input.coupon ?? null,
      billingStateCode: input.billingStateCode,
    },
    rules,
  );
  const breakup: BreakupLine[] = [
    { code: 'BASE', label: totalQty === 1 ? 'Sign' : `Signs (${totalQty})`, amountPaise: itemsPaise },
    ...(installation
      ? [{ code: 'INSTALLATION' as const, label: `Installation (${zone!.name})`, amountPaise: installation }]
      : []),
    ...totals.breakup,
  ];

  return {
    status: 'OK',
    rateCardVersion: rules.rateCardVersion,
    lines,
    breakup,
    itemsPaise,
    installationPaise: installation,
    ...totals.amounts,
    warnings: [...new Set([...warnings, ...totals.warnings])],
  };
}

type LineResult =
  | {
      status: 'OK';
      areaSqft: number;
      billableSqft: number;
      billableH: number;
      ratePerSqftPaise: number;
      unitPricePaise: number;
      qty: number;
      itemsPaise: number;
      breakup: BreakupLine[];
      warnings: PriceWarning[];
    }
  | Extract<PriceResult, { status: 'INVALID' | 'QUOTE_REQUIRED' }>;

function priceLine(input: LineInput, rules: PricingRules): LineResult {
  const { widthIn, heightIn, qty } = input;

  if (!(widthIn > 0) || !(heightIn > 0)) return { status: 'INVALID', reason: 'BAD_DIMENSIONS' };
  if (!Number.isInteger(qty) || qty < 1) return { status: 'INVALID', reason: 'BAD_QTY' };

  const areaH = areaHundredths(widthIn, heightIn);
  const areaSqft = areaH / 100;

  const limits = input.sizeLimits;
  if (limits) {
    if (widthIn < limits.minWidthIn) return { status: 'INVALID', reason: 'MIN_WIDTH' };
    if (heightIn < limits.minHeightIn) return { status: 'INVALID', reason: 'MIN_HEIGHT' };
    if (widthIn > limits.maxWidthIn)
      return { status: 'QUOTE_REQUIRED', reason: 'MAX_WIDTH_EXCEEDED', areaSqft };
    if (heightIn > limits.maxHeightIn)
      return { status: 'QUOTE_REQUIRED', reason: 'MAX_HEIGHT_EXCEEDED', areaSqft };
  }
  if (qty > rules.maxQty) return { status: 'QUOTE_REQUIRED', reason: 'MAX_QTY_EXCEEDED', areaSqft };

  const rate = rules.rates.find(
    (r) => r.productType === input.productType && r.backboardCode === input.backboardCode,
  );
  if (!rate) return { status: 'QUOTE_REQUIRED', reason: 'NO_RATE', areaSqft };

  const warnings: PriceWarning[] = [];
  const breakup: BreakupLine[] = [];

  const ratePaise = input.rateOverridePaise ?? rate.ratePerSqftPaise;
  const billableH = Math.max(areaH, Math.round(rate.minBillableSqft * 100));
  const billableSqft = billableH / 100;

  const base = roundHalfUp((billableH * ratePaise) / 100);
  breakup.push({
    code: 'BASE',
    label: `${billableSqft.toFixed(2)} sq ft × ${formatINR(ratePaise)}`,
    amountPaise: base * qty,
  });

  let multiColor = 0;
  if (input.colorCount > 1 && rules.multiColorSurchargePct > 0) {
    multiColor = roundHalfUp((base * rules.multiColorSurchargePct) / 100);
    breakup.push({
      code: 'MULTICOLOR',
      label: `Multi-colour (+${rules.multiColorSurchargePct}%)`,
      amountPaise: multiColor * qty,
    });
  }

  let addons = 0;
  for (const code of input.addonCodes) {
    const addon = rules.addons.find((a) => a.code === code);
    if (!addon || (addon.appliesTo && !addon.appliesTo.includes(input.productType))) {
      warnings.push('UNKNOWN_ADDON');
      continue;
    }
    const amount =
      addon.pricingType === 'FLAT'
        ? addon.value
        : addon.pricingType === 'PER_SQFT'
          ? roundHalfUp((addon.value * billableH) / 100)
          : roundHalfUp((base * addon.value) / 100);
    addons += amount;
    breakup.push({ code: 'ADDON', label: addon.name, amountPaise: amount * qty });
  }

  const unitPrice = base + multiColor + addons;
  return {
    status: 'OK',
    areaSqft,
    billableSqft,
    billableH,
    ratePerSqftPaise: ratePaise,
    unitPricePaise: unitPrice,
    qty,
    itemsPaise: unitPrice * qty,
    breakup,
    warnings,
  };
}

interface SettleInput {
  items: number;
  installation: number;
  zone: Zone | null;
  coupon: Coupon | null;
  billingStateCode?: string | null;
}

/** Delivery, coupon, GST and rounding, applied once per order. */
function settle(input: SettleInput, rules: PricingRules) {
  const { zone, coupon } = input;
  const warnings: PriceWarning[] = [];
  const breakup: BreakupLine[] = [];
  const subtotal = input.items + input.installation;

  let delivery = 0;
  if (zone) {
    const free = zone.freeDeliveryAbovePaise != null && subtotal >= zone.freeDeliveryAbovePaise;
    delivery = free ? 0 : zone.deliveryChargePaise;
    breakup.push({ code: 'DELIVERY', label: 'Delivery', amountPaise: delivery });
  }

  let discount = 0;
  if (coupon) {
    if (coupon.minOrderPaise != null && subtotal < coupon.minOrderPaise) {
      warnings.push('COUPON_MIN_ORDER_NOT_MET');
    } else {
      discount = coupon.type === 'PERCENT' ? roundHalfUp((subtotal * coupon.value) / 100) : coupon.value;
      if (coupon.maxDiscountPaise != null) discount = Math.min(discount, coupon.maxDiscountPaise);
      discount = Math.min(discount, subtotal);
      breakup.push({ code: 'DISCOUNT', label: coupon.code, amountPaise: -discount });
    }
  }

  const taxable = subtotal + delivery - discount;
  if (taxable < rules.minOrderValuePaise) warnings.push('BELOW_MIN_ORDER_VALUE');

  const intraState = !input.billingStateCode || input.billingStateCode === rules.companyStateCode;
  const halfGst = roundHalfUp((taxable * rules.gstRatePct) / 200);
  const gst = intraState
    ? {
        ratePct: rules.gstRatePct,
        type: 'INTRA' as const,
        cgstPaise: halfGst,
        sgstPaise: halfGst,
        igstPaise: 0,
      }
    : {
        ratePct: rules.gstRatePct,
        type: 'INTER' as const,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: roundHalfUp((taxable * rules.gstRatePct) / 100),
      };

  const total = taxable + gst.cgstPaise + gst.sgstPaise + gst.igstPaise;
  const payable = roundToRupee(total);
  const advanceEligible = payable >= rules.advance.thresholdPaise;

  return {
    breakup,
    warnings,
    amounts: {
      deliveryPaise: delivery,
      discountPaise: discount,
      taxablePaise: taxable,
      gst,
      totalPaise: total,
      roundOffPaise: payable - total,
      payablePaise: payable,
      advance: {
        eligible: advanceEligible,
        amountPaise: advanceEligible ? roundToRupee((payable * rules.advance.pct) / 100) : payable,
      },
      deliveryDays: zone ? { min: zone.deliveryDaysMin, max: zone.deliveryDaysMax } : null,
    },
  };
}

/** Installation for a total billable area, in hundredths of a sq ft. */
function installationCharge(zone: Zone, billableH: number): number {
  return zone.installType === 'FLAT'
    ? zone.installValuePaise
    : roundHalfUp((zone.installValuePaise * billableH) / 100);
}

function roundToRupee(paise: number): number {
  return roundHalfUp(paise / 100) * 100;
}
