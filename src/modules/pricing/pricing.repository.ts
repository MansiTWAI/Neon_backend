import { Injectable } from '@nestjs/common';
import type { Coupon, PricingRules, SizeLimits, Zone } from '@neon-adda/shared';
import { Prisma, PricingMode, ProductType, ServiceZone } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type PricingSettings = Omit<PricingRules, 'rateCardVersion' | 'rates' | 'addons'>;

const FALLBACK_ZONE = 'REST_OF_INDIA';

export interface PricedProduct {
  id: string;
  name: string;
  categoryId: string;
  pricingMode: PricingMode;
  type: ProductType;
  sizeLimits: SizeLimits;
  rateOverridePaise: number | null;
}

const toPaise = (rupees: Prisma.Decimal) => Math.round(Number(rupees) * 100);

/** Reads the admin-managed pricing tables and maps them onto the shared pricing types. */
@Injectable()
export class PricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async publishedRules(at: Date): Promise<PricingRules | null> {
    const [version, addons, settings] = await Promise.all([
      this.prisma.rateCardVersion.findFirst({
        where: { status: 'PUBLISHED', effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: 'desc' },
        include: { entries: { include: { backboard: true } } },
      }),
      this.prisma.addon.findMany({ where: { isActive: true }, orderBy: { sort: 'asc' } }),
      this.prisma.setting.findUnique({ where: { key: 'pricing' } }),
    ]);
    if (!version || !settings) return null;

    return {
      ...(settings.value as unknown as PricingSettings),
      rateCardVersion: version.versionNo,
      rates: version.entries.map((entry) => ({
        productType: entry.productType,
        backboardCode: entry.backboard.code,
        ratePerSqftPaise: toPaise(entry.ratePerSqft),
        minBillableSqft: Number(entry.minBillableSqft),
      })),
      addons: addons.map((addon) => ({
        code: addon.code,
        name: addon.name,
        pricingType: addon.pricingType,
        value: Number(addon.value),
        appliesTo: addon.appliesTo.length ? addon.appliesTo : null,
      })),
    };
  }

  async product(id: string): Promise<PricedProduct | null> {
    const product = await this.prisma.product.findFirst({ where: { id, isActive: true, deletedAt: null } });
    if (!product) return null;

    return {
      id: product.id,
      name: product.name,
      categoryId: product.categoryId,
      pricingMode: product.pricingMode,
      type: product.type,
      sizeLimits: {
        minWidthIn: Number(product.minWidthIn),
        maxWidthIn: Number(product.maxWidthIn),
        minHeightIn: Number(product.minHeightIn),
        maxHeightIn: Number(product.maxHeightIn),
      },
      rateOverridePaise: product.rateOverride ? toPaise(product.rateOverride) : null,
    };
  }

  /** Pincodes outside every mapped zone fall back to the nationwide courier zone. */
  async zoneForPincode(pincode: string): Promise<Zone | null> {
    const mapped = await this.prisma.zonePincode.findUnique({ where: { pincode }, include: { zone: true } });
    const zone =
      mapped?.zone ?? (await this.prisma.serviceZone.findUnique({ where: { code: FALLBACK_ZONE } }));
    return zone?.isActive ? toZone(zone) : null;
  }

  /** City and GST state for a pincode, when it is in the directory. */
  async place(pincode: string): Promise<{ city: string; district: string; stateCode: string } | null> {
    return this.prisma.pincode.findUnique({
      where: { pincode },
      select: { city: true, district: true, stateCode: true },
    });
  }

  async activeCoupon(code: string, now: Date): Promise<Coupon | null> {
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
    });
    if (!coupon) return null;

    return {
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value),
      maxDiscountPaise: coupon.maxDiscountPaise == null ? null : Number(coupon.maxDiscountPaise),
      minOrderPaise: coupon.minOrderPaise == null ? null : Number(coupon.minOrderPaise),
    };
  }
}

function toZone(zone: ServiceZone): Zone {
  return {
    code: zone.code,
    name: zone.name,
    deliveryChargePaise: Number(zone.deliveryChargePaise),
    freeDeliveryAbovePaise: zone.freeDeliveryAbovePaise == null ? null : Number(zone.freeDeliveryAbovePaise),
    installAvailable: zone.installAvailable,
    installType: zone.installType,
    installValuePaise: Number(zone.installValuePaise),
    deliveryDaysMin: zone.deliveryDaysMin,
    deliveryDaysMax: zone.deliveryDaysMax,
  };
}
