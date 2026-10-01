import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestMeta } from '../../../common/http/request-meta';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PricingService } from '../../pricing/pricing.service';
import {
  AddonsDto,
  CouponDto,
  PricingRulesDto,
  RateEntriesDto,
  ZoneDto,
  ZonePincodesDto,
} from './admin-pricing.dto';

const paise = (value: bigint | null) => (value === null ? null : Number(value));
const toPaise = (rupees: Prisma.Decimal) => Math.round(Number(rupees) * 100);

/**
 * Admin control of every price the storefront shows. Rate cards are versioned: staff edit a
 * draft and publish it, and orders keep the version they were priced with.
 */
@Injectable()
export class AdminPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  async rateCards() {
    const versions = await this.prisma.rateCardVersion.findMany({
      orderBy: { versionNo: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
    return versions.map(({ _count, ...version }) => ({ ...version, entries: _count.entries }));
  }

  async rateCard(id: string) {
    const [version, backboards] = await Promise.all([
      this.prisma.rateCardVersion.findUnique({
        where: { id },
        include: { entries: { include: { backboard: { select: { code: true } } } } },
      }),
      this.prisma.backboard.findMany({
        orderBy: { sort: 'asc' },
        select: { code: true, name: true, isActive: true },
      }),
    ]);
    if (!version) throw new NotFoundException({ code: 'RATE_CARD_NOT_FOUND', title: 'Rate card not found' });

    const { entries, ...rest } = version;
    return {
      ...rest,
      backboards,
      entries: entries.map((entry) => ({
        productType: entry.productType,
        backboardCode: entry.backboard.code,
        ratePerSqftPaise: toPaise(entry.ratePerSqft),
        minBillableSqft: Number(entry.minBillableSqft),
      })),
    };
  }

  /** Starts a draft from the live rates. There is only ever one draft, so this returns it if it exists. */
  async createDraft(actorId: string, meta: RequestMeta) {
    const existing = await this.prisma.rateCardVersion.findFirst({ where: { status: 'DRAFT' } });
    if (existing) return this.rateCard(existing.id);

    const [published, last] = await Promise.all([
      this.prisma.rateCardVersion.findFirst({
        where: { status: 'PUBLISHED' },
        orderBy: { effectiveFrom: 'desc' },
        include: { entries: true },
      }),
      this.prisma.rateCardVersion.aggregate({ _max: { versionNo: true } }),
    ]);

    const draft = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rateCardVersion.create({
        data: {
          versionNo: (last._max.versionNo ?? 0) + 1,
          status: 'DRAFT',
          effectiveFrom: new Date(),
          entries: {
            create: (published?.entries ?? []).map(
              ({ productType, backboardId, ratePerSqft, minBillableSqft }) => ({
                productType,
                backboardId,
                ratePerSqft,
                minBillableSqft,
              }),
            ),
          },
        },
      });
      await this.audit.record(
        { actorId, action: 'rate-card.drafted', entity: 'rate-card', entityId: created.id, ...meta },
        tx,
      );
      return created;
    });
    return this.rateCard(draft.id);
  }

  async saveEntries(actorId: string, id: string, dto: RateEntriesDto, meta: RequestMeta) {
    const version = await this.draft(id);
    const backboards = await this.prisma.backboard.findMany({
      where: { code: { in: [...new Set(dto.entries.map((e) => e.backboardCode))] } },
      select: { id: true, code: true },
    });
    const boardId = new Map(backboards.map((b) => [b.code, b.id]));
    const unknown = dto.entries.find((e) => !boardId.has(e.backboardCode));
    if (unknown) {
      throw new UnprocessableEntityException({
        code: 'UNKNOWN_BACKBOARD',
        title: `No backboard ${unknown.backboardCode}`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rateCardEntry.deleteMany({ where: { versionId: version.id } });
      await tx.rateCardEntry.createMany({
        data: dto.entries.map((entry) => ({
          versionId: version.id,
          productType: entry.productType,
          backboardId: boardId.get(entry.backboardCode)!,
          ratePerSqft: entry.ratePerSqftPaise / 100,
          minBillableSqft: entry.minBillableSqft,
        })),
      });
      await tx.rateCardVersion.update({ where: { id: version.id }, data: { notes: dto.notes } });
      await this.audit.record(
        {
          actorId,
          action: 'rate-card.edited',
          entity: 'rate-card',
          entityId: version.id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return this.rateCard(id);
  }

  /** The draft goes live at once; the card it replaces is archived, not deleted. */
  async publish(actorId: string, id: string, meta: RequestMeta) {
    const version = await this.draft(id);
    const entries = await this.prisma.rateCardEntry.count({ where: { versionId: id } });
    if (!entries)
      throw new UnprocessableEntityException({ code: 'EMPTY_RATE_CARD', title: 'Add at least one rate' });

    await this.prisma.$transaction(async (tx) => {
      await tx.rateCardVersion.updateMany({ where: { status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      await tx.rateCardVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          effectiveFrom: new Date(),
          publishedAt: new Date(),
          publishedBy: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'rate-card.published',
          entity: 'rate-card',
          entityId: id,
          after: { versionNo: version.versionNo },
          ...meta,
        },
        tx,
      );
    });
    this.pricing.invalidate();
    return this.rateCard(id);
  }

  async discardDraft(actorId: string, id: string, meta: RequestMeta) {
    await this.draft(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.rateCardVersion.delete({ where: { id } });
      await this.audit.record(
        { actorId, action: 'rate-card.discarded', entity: 'rate-card', entityId: id, ...meta },
        tx,
      );
    });
  }

  async rules() {
    const [setting, addons] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'pricing' } }),
      this.prisma.addon.findMany({ orderBy: { sort: 'asc' } }),
    ]);
    return {
      rules: setting?.value ?? null,
      addons: addons.map((addon) => ({
        code: addon.code,
        name: addon.name,
        pricingType: addon.pricingType,
        value: Number(addon.value),
        isActive: addon.isActive,
      })),
    };
  }

  async saveRules(actorId: string, dto: PricingRulesDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where: { key: 'pricing' } });
      await tx.setting.upsert({
        where: { key: 'pricing' },
        update: { value: dto, updatedBy: actorId },
        create: { key: 'pricing', value: dto, updatedBy: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: 'pricing.rules-changed',
          entity: 'setting',
          entityId: 'pricing',
          before: before?.value,
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    this.pricing.invalidate();
    return this.rules();
  }

  /** Extras are matched by code. Ones left out are switched off rather than deleted, since orders name them. */
  async saveAddons(actorId: string, dto: AddonsDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const codes = dto.addons.map((a) => a.code);
      await tx.addon.updateMany({ where: { code: { notIn: codes } }, data: { isActive: false } });
      for (const [sort, addon] of dto.addons.entries()) {
        await tx.addon.upsert({
          where: { code: addon.code },
          update: { ...addon, sort },
          create: { ...addon, sort, appliesTo: [] },
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'pricing.addons-changed',
          entity: 'setting',
          entityId: 'addons',
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    this.pricing.invalidate();
    return this.rules();
  }

  async zones() {
    const zones = await this.prisma.serviceZone.findMany({
      orderBy: { createdAt: 'asc' },
      include: { pincodes: { orderBy: { pincode: 'asc' }, select: { pincode: true } } },
    });
    return zones.map(({ pincodes, ...zone }) => ({
      ...zone,
      deliveryChargePaise: Number(zone.deliveryChargePaise),
      freeDeliveryAbovePaise: paise(zone.freeDeliveryAbovePaise),
      installValuePaise: Number(zone.installValuePaise),
      pincodes: pincodes.map((p) => p.pincode),
    }));
  }

  async saveZone(actorId: string, id: string | null, dto: ZoneDto, meta: RequestMeta) {
    const data = {
      ...dto,
      deliveryChargePaise: BigInt(dto.deliveryChargePaise),
      freeDeliveryAbovePaise: dto.freeDeliveryAbovePaise === null ? null : BigInt(dto.freeDeliveryAbovePaise),
      installValuePaise: BigInt(dto.installValuePaise),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const zone = id
          ? await tx.serviceZone.update({ where: { id }, data })
          : await tx.serviceZone.create({ data });
        await this.audit.record(
          {
            actorId,
            action: id ? 'zone.updated' : 'zone.created',
            entity: 'zone',
            entityId: zone.id,
            after: dto,
            ...meta,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateUnique(error, 'A zone with this code already exists');
    }
    this.pricing.invalidate();
    return this.zones();
  }

  /** A pincode belongs to one zone; adding it here moves it from wherever it was. */
  async savePincodes(actorId: string, id: string, dto: ZonePincodesDto, meta: RequestMeta) {
    const zone = await this.prisma.serviceZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException({ code: 'ZONE_NOT_FOUND', title: 'Zone not found' });

    await this.prisma.$transaction(async (tx) => {
      if (dto.remove.length)
        await tx.zonePincode.deleteMany({ where: { zoneId: id, pincode: { in: dto.remove } } });
      if (dto.add.length) {
        await tx.zonePincode.deleteMany({ where: { pincode: { in: dto.add } } });
        await tx.zonePincode.createMany({
          data: [...new Set(dto.add)].map((pincode) => ({ zoneId: id, pincode })),
        });
      }
      await this.audit.record(
        { actorId, action: 'zone.pincodes-changed', entity: 'zone', entityId: id, after: dto, ...meta },
        tx,
      );
    });
    return this.zones();
  }

  async coupons() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { redemptions: { where: { order: { status: { notIn: ['CANCELLED', 'EXPIRED'] } } } } },
        },
      },
    });
    return coupons.map(({ _count, ...coupon }) => ({
      ...coupon,
      value: Number(coupon.value),
      maxDiscountPaise: paise(coupon.maxDiscountPaise),
      minOrderPaise: paise(coupon.minOrderPaise),
      used: _count.redemptions,
    }));
  }

  async saveCoupon(actorId: string, id: string | null, dto: CouponDto, meta: RequestMeta) {
    const data = {
      ...dto,
      maxDiscountPaise: dto.maxDiscountPaise === null ? null : BigInt(dto.maxDiscountPaise),
      minOrderPaise: dto.minOrderPaise === null ? null : BigInt(dto.minOrderPaise),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const coupon = id
          ? await tx.coupon.update({ where: { id }, data })
          : await tx.coupon.create({ data });
        await this.audit.record(
          {
            actorId,
            action: id ? 'coupon.updated' : 'coupon.created',
            entity: 'coupon',
            entityId: coupon.id,
            after: dto,
            ...meta,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateUnique(error, 'A coupon with this code already exists');
    }
    return this.coupons();
  }

  private async draft(id: string) {
    const version = await this.prisma.rateCardVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException({ code: 'RATE_CARD_NOT_FOUND', title: 'Rate card not found' });
    if (version.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'RATE_CARD_LOCKED',
        title: 'Published rate cards cannot be changed. Start a new draft.',
      });
    }
    return version;
  }
}

export function translateUnique(error: unknown, title: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException({ code: 'ALREADY_EXISTS', title });
    if (error.code === 'P2025') return new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
  }
  return error;
}
