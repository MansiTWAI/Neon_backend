import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formatINR, OrderPriceOk } from '@neon-adda/shared';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { DesignsService, ResolvedDesign } from '../designs/designs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderWorkflowService } from '../order-workflow/order-workflow.service';
import { RazorpayGateway } from '../payments/razorpay.gateway';
import { OrderPricing, PricingService } from '../pricing/pricing.service';
import { addressSnapshot } from './address-snapshot';
import { nextOrderNo } from './document-numbers';
import { CheckoutPriceDto, PlaceOrderDto } from './orders.dto';

const QUOTE_REASONS: Record<string, string> = {
  MAX_WIDTH_EXCEEDED: 'is wider than we make online',
  MAX_HEIGHT_EXCEEDED: 'is taller than we make online',
  MAX_QTY_EXCEEDED: 'is more signs than we take in one online order',
  NO_RATE: 'needs a custom quotation',
};

export interface PlacedOrder {
  orderNo: string;
  /** True for an online order: the storefront opens the payment window next. */
  paymentRequired: boolean;
}

/** How long an identical order request from the same customer counts as a repeat. */
const REPEAT_WINDOW_MS = 30_000;

@Injectable()
export class CheckoutService {
  private readonly recent = new Map<string, { result: Promise<PlacedOrder>; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignsService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
    private readonly workflow: OrderWorkflowService,
    private readonly gateway: RazorpayGateway,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async price(dto: CheckoutPriceDto) {
    const resolved = await this.designs.resolve(dto.lines);
    const pricing = await this.pricing.calculateOrder(
      resolved.map((r) => r.line),
      {
        pincode: dto.pincode,
        installation: dto.installation,
        couponCode: dto.couponCode,
        billingStateCode: dto.billingStateCode,
      },
    );
    return {
      price: pricing.price,
      coupon: pricing.coupon,
      zone: pricing.zone && {
        name: pricing.zone.name,
        installationAvailable: pricing.zone.installAvailable,
      },
      minOrderValuePaise: pricing.rules.minOrderValuePaise,
      /** Cash on delivery is always offered; paying online only once the gateway is set up. */
      paymentMethods: { cod: true, online: this.gateway.configured },
      lines: resolved.map((r) => ({
        description: r.description,
        quoteOnly: r.product.pricingMode === 'QUOTE',
      })),
    };
  }

  /**
   * Places the order once even when the same request arrives twice in quick succession: a double
   * tap on "Place order" or a request the network retried. The repeat gets the first order back.
   * A request that failed may be sent again straight away.
   */
  place(userId: string, dto: PlaceOrderDto): Promise<PlacedOrder> {
    const now = Date.now();
    for (const [key, entry] of this.recent) if (now - entry.at > REPEAT_WINDOW_MS) this.recent.delete(key);
    const key = `${userId}:${createHash('sha256').update(JSON.stringify(dto)).digest('hex')}`;
    const earlier = this.recent.get(key);
    if (earlier) return earlier.result;
    const result = this.placeOnce(userId, dto);
    this.recent.set(key, { result, at: now });
    result.catch(() => this.recent.delete(key));
    return result;
  }

  /** After a customer cancels, ordering the same thing again places a new order, not the cancelled one. */
  forgetRecent(userId: string) {
    for (const key of this.recent.keys()) if (key.startsWith(`${userId}:`)) this.recent.delete(key);
  }

  private async placeOnce(userId: string, dto: PlaceOrderDto): Promise<PlacedOrder> {
    const online = dto.paymentMode === 'ONLINE';
    if (online && !this.gateway.configured) {
      throw new UnprocessableEntityException({
        code: 'ONLINE_PAYMENT_UNAVAILABLE',
        title: 'Online payment is not available right now. Choose cash on delivery.',
      });
    }
    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!address)
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', title: 'Choose a delivery address' });

    const resolved = await this.designs.resolve(dto.lines);
    const quoteOnly = resolved.findIndex((r) => r.product.pricingMode === 'QUOTE');
    if (quoteOnly >= 0) {
      throw new UnprocessableEntityException({
        code: 'QUOTE_REQUIRED',
        title: `${resolved[quoteOnly]!.product.name} is priced by quotation`,
        lineIndex: quoteOnly,
      });
    }

    const pricing = await this.pricing.calculateOrder(
      resolved.map((r) => r.line),
      {
        pincode: address.pincode,
        installation: dto.installation,
        couponCode: dto.couponCode,
        billingStateCode: address.stateCode,
      },
    );
    const price = this.assertPlaceable(pricing, dto, resolved);

    const previewKeys = await Promise.all(dto.lines.map((line) => this.designs.storePreview(line.preview)));
    // A standee referral earns the franchise its own-sourced rate; otherwise the pincode's franchise handles it.
    const [referrer, territory] = await Promise.all([
      dto.referralCode
        ? this.prisma.franchise.findFirst({
            where: { code: dto.referralCode, status: 'ACTIVE', deletedAt: null },
            select: { id: true },
          })
        : null,
      this.prisma.franchiseTerritory.findUnique({
        where: { pincode: address.pincode },
        select: { franchise: { select: { id: true, status: true } } },
      }),
    ]);
    const franchiseId =
      referrer?.id ?? (territory?.franchise.status === 'ACTIVE' ? territory.franchise.id : null);
    const attributionSource = referrer ? 'SELF_SOURCED' : franchiseId ? 'ASSIGNED' : 'NONE';

    const orderNo = await this.prisma.$transaction(async (tx) => {
      const coupon = dto.couponCode ? await this.redeemableCoupon(tx, userId, dto.couponCode) : null;
      const orderNo = await nextOrderNo(tx);
      const designs = await Promise.all(
        resolved.map((r, i) =>
          this.designs.create(tx, userId, r.design, { previewKey: previewKeys[i] ?? null, saved: false }),
        ),
      );
      const snapshot = addressSnapshot(address);
      const payable = BigInt(price.payablePaise);

      const order = await tx.order.create({
        data: {
          orderNo,
          customerId: userId,
          channel: referrer ? 'KIOSK' : 'WEB',
          franchiseId,
          attributionSource,
          paymentMode: online ? 'FULL' : 'COD',
          // An online order waits for its payment, which is only accepted once Razorpay confirms it.
          status: 'PENDING_PAYMENT',
          expiresAt: online
            ? new Date(
                Date.now() + this.config.get('ONLINE_PAYMENT_WINDOW_MINUTES', { infer: true }) * 60_000,
              )
            : null,
          subtotalPaise: BigInt(price.itemsPaise),
          discountPaise: BigInt(price.discountPaise),
          installationPaise: BigInt(price.installationPaise),
          deliveryPaise: BigInt(price.deliveryPaise),
          taxablePaise: BigInt(price.taxablePaise),
          cgstPaise: BigInt(price.gst.cgstPaise),
          sgstPaise: BigInt(price.gst.sgstPaise),
          igstPaise: BigInt(price.gst.igstPaise),
          roundOffPaise: BigInt(price.roundOffPaise),
          totalPaise: payable,
          amountDuePaise: payable,
          advanceRequiredPaise: online ? payable : 0n,
          shippingAddress: snapshot,
          billingAddress: snapshot,
          placeOfSupplyState: address.stateCode,
          customerGstin: address.gstin,
          couponId: coupon?.id,
          pricingSnapshot: price as unknown as Prisma.InputJsonValue,
          installationRequired: price.installationPaise > 0,
          items: {
            create: resolved.map((r, i) => {
              const line = price.lines[i]!;
              return {
                designId: designs[i]!.id,
                productId: r.product.id,
                categoryId: r.product.categoryId,
                description: r.description,
                widthIn: r.design.widthIn,
                heightIn: r.design.heightIn,
                areaSqft: line.areaSqft,
                billableSqft: line.billableSqft,
                ratePerSqft: line.ratePerSqftPaise / 100,
                addons: line.breakup
                  .filter((b) => b.code === 'ADDON' || b.code === 'MULTICOLOR')
                  .map(({ label, amountPaise }) => ({ label, amountPaise })),
                qty: line.qty,
                unitPricePaise: BigInt(line.unitPricePaise),
                lineTaxablePaise: BigInt(line.itemsPaise),
                lineInstallationPaise: BigInt(line.installationPaise),
              };
            }),
          },
        },
      });

      if (coupon) {
        await tx.couponRedemption.create({
          data: {
            couponId: coupon.id,
            orderId: order.id,
            userId,
            discountPaise: BigInt(price.discountPaise),
          },
        });
      }
      if (!online) {
        await this.workflow.confirm(tx, await this.workflow.load(tx, order.id), userId, {
          note: 'Order placed, cash on delivery',
          actorType: 'CUSTOMER',
        });
      }
      return orderNo;
    });

    // The confirmation for an online order goes out when the payment is confirmed.
    if (online) return { orderNo, paymentRequired: true };

    await this.notifications.notify(
      userId,
      {
        kind: 'order.placed',
        title: `Order ${orderNo} placed`,
        body: `${formatINR(price.payablePaise)} for ${resolved.length === 1 ? 'your sign' : `${resolved.length} signs`}. Pay in cash when it arrives.`,
        link: `/orders/${orderNo}`,
      },
      ['customer'],
    );
    return { orderNo, paymentRequired: false };
  }

  /** Every reason an order cannot go through, as a problem the checkout page can show. */
  private assertPlaceable(
    pricing: OrderPricing,
    dto: PlaceOrderDto,
    resolved: ResolvedDesign[],
  ): OrderPriceOk {
    const { price, coupon } = pricing;

    if (price.status !== 'OK') {
      const sign = price.lineIndex === null ? 'This order' : `"${resolved[price.lineIndex]!.description}"`;
      throw new UnprocessableEntityException({
        code: price.status === 'QUOTE_REQUIRED' ? 'QUOTE_REQUIRED' : 'INVALID_SIGN',
        title:
          price.status === 'QUOTE_REQUIRED'
            ? `${sign} ${QUOTE_REASONS[price.reason]}. Request a quotation for it instead.`
            : `${sign} is smaller than we can make`,
        lineIndex: price.lineIndex,
      });
    }
    if (coupon && !coupon.applied) {
      throw new UnprocessableEntityException({ code: 'COUPON_NOT_APPLICABLE', title: coupon.message });
    }
    if (price.warnings.includes('INSTALLATION_NOT_AVAILABLE')) {
      throw new UnprocessableEntityException({
        code: 'INSTALLATION_NOT_AVAILABLE',
        title: 'We do not install at this pincode yet. Choose delivery only.',
      });
    }
    if (price.warnings.includes('BELOW_MIN_ORDER_VALUE')) {
      throw new UnprocessableEntityException({
        code: 'BELOW_MIN_ORDER_VALUE',
        title: `The minimum order is ${formatINR(pricing.rules.minOrderValuePaise)} before GST`,
      });
    }
    if (price.payablePaise !== dto.expectedPayablePaise) {
      throw new ConflictException({
        code: 'PRICE_CHANGED',
        title: `The total is now ${formatINR(price.payablePaise)}. Please review your order again.`,
        price,
      });
    }
    return price;
  }

  /** Usage limits are checked inside the order transaction so two checkouts cannot both take the last use. */
  private async redeemableCoupon(tx: Prisma.TransactionClient, userId: string, code: string) {
    const coupon = await tx.coupon.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } });
    if (!coupon) return null;

    const live = { order: { status: { notIn: ['CANCELLED' as const, 'EXPIRED' as const] } } };
    const [used, usedByCustomer, previousOrders] = await Promise.all([
      coupon.usageLimit ? tx.couponRedemption.count({ where: { couponId: coupon.id, ...live } }) : 0,
      coupon.perUserLimit
        ? tx.couponRedemption.count({ where: { couponId: coupon.id, userId, ...live } })
        : 0,
      coupon.firstOrderOnly
        ? tx.order.count({ where: { customerId: userId, status: { notIn: ['CANCELLED', 'EXPIRED'] } } })
        : 0,
    ]);

    const problem =
      coupon.usageLimit && used >= coupon.usageLimit
        ? 'This coupon has been fully used'
        : coupon.perUserLimit && usedByCustomer >= coupon.perUserLimit
          ? 'You have already used this coupon'
          : coupon.firstOrderOnly && previousOrders > 0
            ? 'This coupon is for your first order only'
            : null;
    if (problem) throw new UnprocessableEntityException({ code: 'COUPON_NOT_APPLICABLE', title: problem });
    return coupon;
  }
}
