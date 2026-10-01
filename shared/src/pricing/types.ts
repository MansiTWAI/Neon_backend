export type ProductType = 'TEXT_NEON' | 'LOGO_NEON' | 'READYMADE' | 'BUSINESS';
export type AddonPricingType = 'FLAT' | 'PER_SQFT' | 'PERCENT';

export interface RateEntry {
  productType: ProductType;
  backboardCode: string;
  ratePerSqftPaise: number;
  minBillableSqft: number;
}

export interface Addon {
  code: string;
  name: string;
  pricingType: AddonPricingType;
  /** Paise for FLAT and PER_SQFT, a percentage of the base price for PERCENT. */
  value: number;
  appliesTo?: ProductType[] | null;
}

export interface Zone {
  code: string;
  name: string;
  deliveryChargePaise: number;
  freeDeliveryAbovePaise?: number | null;
  installAvailable: boolean;
  installType: 'FLAT' | 'PER_SQFT';
  installValuePaise: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
}

export interface Coupon {
  code: string;
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number | null;
  minOrderPaise?: number | null;
}

export interface SizeLimits {
  minWidthIn: number;
  maxWidthIn: number;
  minHeightIn: number;
  maxHeightIn: number;
}

/** Everything the admin controls, published as one document so browsers can price without a round trip. */
export interface PricingRules {
  rateCardVersion: number;
  rates: RateEntry[];
  addons: Addon[];
  multiColorSurchargePct: number;
  gstRatePct: number;
  hsnCode: string;
  companyStateCode: string;
  minOrderValuePaise: number;
  maxQty: number;
  advance: { thresholdPaise: number; pct: number };
}

/** One sign, before anything that depends on the delivery address. */
export interface LineInput {
  productType: ProductType;
  backboardCode: string;
  widthIn: number;
  heightIn: number;
  colorCount: number;
  addonCodes: string[];
  qty: number;
  sizeLimits?: SizeLimits | null;
  rateOverridePaise?: number | null;
}

export interface PriceInput extends LineInput {
  installation: boolean;
  zone?: Zone | null;
  coupon?: Coupon | null;
  /** GST state code of the billing address. When absent the sale is treated as intra-state. */
  billingStateCode?: string | null;
}

export interface OrderInput {
  lines: LineInput[];
  installation: boolean;
  zone?: Zone | null;
  coupon?: Coupon | null;
  billingStateCode?: string | null;
}

export type BreakupCode = 'BASE' | 'MULTICOLOR' | 'ADDON' | 'INSTALLATION' | 'DELIVERY' | 'DISCOUNT';

export interface BreakupLine {
  code: BreakupCode;
  label: string;
  amountPaise: number;
}

export type PriceWarning =
  'INSTALLATION_NOT_AVAILABLE' | 'COUPON_MIN_ORDER_NOT_MET' | 'BELOW_MIN_ORDER_VALUE' | 'UNKNOWN_ADDON';

export interface PriceOk {
  status: 'OK';
  rateCardVersion: number;
  areaSqft: number;
  billableSqft: number;
  ratePerSqftPaise: number;
  unitPricePaise: number;
  qty: number;
  breakup: BreakupLine[];
  itemsPaise: number;
  installationPaise: number;
  deliveryPaise: number;
  discountPaise: number;
  taxablePaise: number;
  gst: {
    ratePct: number;
    type: 'INTRA' | 'INTER';
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  };
  totalPaise: number;
  roundOffPaise: number;
  payablePaise: number;
  advance: { eligible: boolean; amountPaise: number };
  deliveryDays: { min: number; max: number } | null;
  warnings: PriceWarning[];
}

export interface PriceQuoteRequired {
  status: 'QUOTE_REQUIRED';
  reason: 'MAX_WIDTH_EXCEEDED' | 'MAX_HEIGHT_EXCEEDED' | 'MAX_QTY_EXCEEDED' | 'NO_RATE';
  areaSqft: number;
}

export interface PriceInvalid {
  status: 'INVALID';
  reason: 'MIN_WIDTH' | 'MIN_HEIGHT' | 'BAD_DIMENSIONS' | 'BAD_QTY';
}

export type PriceResult = PriceOk | PriceQuoteRequired | PriceInvalid;

export interface OrderLinePrice {
  areaSqft: number;
  billableSqft: number;
  ratePerSqftPaise: number;
  unitPricePaise: number;
  qty: number;
  itemsPaise: number;
  /** This line's share of the order's installation charge. */
  installationPaise: number;
  breakup: BreakupLine[];
}

type OrderTotals = Pick<
  PriceOk,
  | 'rateCardVersion'
  | 'breakup'
  | 'itemsPaise'
  | 'installationPaise'
  | 'deliveryPaise'
  | 'discountPaise'
  | 'taxablePaise'
  | 'gst'
  | 'totalPaise'
  | 'roundOffPaise'
  | 'payablePaise'
  | 'advance'
  | 'deliveryDays'
  | 'warnings'
>;

export interface OrderPriceOk extends OrderTotals {
  status: 'OK';
  lines: OrderLinePrice[];
}

export type OrderPriceResult =
  | OrderPriceOk
  | { status: 'QUOTE_REQUIRED'; reason: PriceQuoteRequired['reason']; lineIndex: number | null }
  | { status: 'INVALID'; reason: PriceInvalid['reason'] | 'EMPTY'; lineIndex: number | null };
