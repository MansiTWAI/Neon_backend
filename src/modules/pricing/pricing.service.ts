import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  calculateOrder,
  calculatePrice,
  formatINR,
  LineInput,
  OrderPriceResult,
  PriceResult,
  PricingRules,
  ProductType,
  SizeLimits,
  Zone,
} from '@neon-adda/shared';
import { CalculatePriceDto } from './pricing.dto';
import { PricingRepository } from './pricing.repository';

const RULES_TTL_MS = 60_000;

export interface OrderPricingOptions {
  pincode?: string;
  installation: boolean;
  couponCode?: string;
  billingStateCode?: string | null;
}

export interface OrderPricing {
  price: OrderPriceResult;
  zone: Zone | null;
  coupon: { code: string; applied: boolean; message: string | null } | null;
  rules: PricingRules;
}

@Injectable()
export class PricingService {
  private cached: { rules: PricingRules; loadedAt: number } | null = null;

  constructor(private readonly repository: PricingRepository) {}

  async currentRules(): Promise<PricingRules> {
    if (this.cached && Date.now() - this.cached.loadedAt < RULES_TTL_MS) return this.cached.rules;

    const rules = await this.repository.publishedRules(new Date());
    if (!rules) {
      throw new ServiceUnavailableException({
        code: 'RATE_CARD_UNAVAILABLE',
        title: 'No rate card is published',
      });
    }
    this.cached = { rules, loadedAt: Date.now() };
    return rules;
  }

  /** Called after the admin publishes a new rate card. */
  invalidate() {
    this.cached = null;
  }

  async calculate(dto: CalculatePriceDto): Promise<PriceResult> {
    const now = new Date();
    const [rules, product, zone, coupon] = await Promise.all([
      this.currentRules(),
      dto.productId ? this.repository.product(dto.productId) : null,
      dto.pincode ? this.repository.zoneForPincode(dto.pincode) : null,
      dto.couponCode ? this.repository.activeCoupon(dto.couponCode, now) : null,
    ]);

    if (dto.productId && !product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        title: 'This product is no longer available',
      });
    }

    const productType: ProductType = product?.type ?? dto.productType ?? 'TEXT_NEON';
    const sizeLimits: SizeLimits | null = product?.sizeLimits ?? null;

    return calculatePrice(
      {
        productType,
        backboardCode: dto.backboardCode,
        widthIn: dto.widthIn,
        heightIn: dto.heightIn,
        colorCount: dto.colorCount,
        addonCodes: dto.addonCodes,
        qty: dto.qty,
        installation: dto.installation,
        billingStateCode: dto.billingStateCode ?? null,
        zone,
        coupon,
        sizeLimits,
        rateOverridePaise: product?.rateOverridePaise ?? null,
      },
      rules,
    );
  }

  /** Prices a cart for delivery to `pincode`. Coupon problems are reported, not thrown, so checkout can show them. */
  async calculateOrder(lines: LineInput[], options: OrderPricingOptions): Promise<OrderPricing> {
    const now = new Date();
    const [rules, zone, coupon] = await Promise.all([
      this.currentRules(),
      options.pincode ? this.repository.zoneForPincode(options.pincode) : null,
      options.couponCode ? this.repository.activeCoupon(options.couponCode, now) : null,
    ]);

    const price = calculateOrder(
      {
        lines,
        installation: options.installation,
        zone,
        coupon,
        billingStateCode: options.billingStateCode ?? null,
      },
      rules,
    );

    let couponStatus: OrderPricing['coupon'] = null;
    if (options.couponCode) {
      const notMet = price.status === 'OK' && price.warnings.includes('COUPON_MIN_ORDER_NOT_MET');
      couponStatus = !coupon
        ? { code: options.couponCode, applied: false, message: 'This coupon is not valid' }
        : notMet
          ? {
              code: coupon.code,
              applied: false,
              message: `Add ${formatINR((coupon.minOrderPaise ?? 0) - (price.status === 'OK' ? price.itemsPaise + price.installationPaise : 0))} more to use this coupon`,
            }
          : { code: coupon.code, applied: true, message: null };
    }

    return { price, zone, coupon: couponStatus, rules };
  }

  async serviceability(pincode: string) {
    const [zone, place] = await Promise.all([
      this.repository.zoneForPincode(pincode),
      this.repository.place(pincode),
    ]);
    if (!zone) return { pincode, serviceable: false, place };

    return {
      pincode,
      serviceable: true,
      place,
      zone: zone.name,
      installationAvailable: zone.installAvailable,
      deliveryDays: { min: zone.deliveryDaysMin, max: zone.deliveryDaysMax },
    };
  }
}
