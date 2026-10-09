import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { calculatePrice, formatINR, roundHalfUp } from '@neon-adda/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { letteringOf } from '../designs/design.dto';
import { DesignsService } from '../designs/designs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderWorkflowService } from '../order-workflow/order-workflow.service';
import { PricingService } from '../pricing/pricing.service';
import { StorageService } from '../storage/storage.service';
import { addressSnapshot } from '../orders/address-snapshot';
import { nextOrderNo, nextQuoteNo } from '../orders/document-numbers';
import { AcceptQuoteDto, QuoteResponseDto, RequestQuoteDto } from './quotations.dto';

const include = {
  items: { orderBy: { id: 'asc' } },
  design: { select: { previewKey: true, config: true } },
  orders: { select: { orderNo: true }, take: 1 },
} satisfies Prisma.QuotationInclude;

type QuotationWithItems = Prisma.QuotationGetPayload<{ include: typeof include }>;

interface RequestDetails {
  kind: RequestQuoteDto['kind'];
  widthIn: number | null;
  heightIn: number | null;
  qty: number;
  pincode: string;
  installation: boolean;
  message: string | null;
  logoKey: string | null;
  /** A picture sent without a studio design, such as one made in the AI designer. */
  referenceKey?: string | null;
  /** What the rate card says, as a starting point for the sales team. Never shown as a price. */
  estimatePaise: number | null;
}

const paise = (value: bigint) => Number(value);

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignsService,
    private readonly pricing: PricingService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  async request(userId: string, dto: RequestQuoteDto) {
    let logoKey: string | null = null;
    let estimatePaise: number | null = null;

    if (dto.design) {
      const [resolved] = await this.designs.resolve([{ design: dto.design, qty: 1 }]);
      await this.designs.assertLogoOwned(userId, dto.design);
      if (dto.design.config.mode === 'LOGO') {
        const upload = await this.prisma.upload.findUniqueOrThrow({
          where: { id: dto.design.config.uploadId },
        });
        logoKey = upload.s3Key;
      }
      // Estimates ignore the size limits: a sign too big for instant pricing is exactly why a quote is wanted.
      const estimate = calculatePrice(
        { ...resolved!.line, sizeLimits: null, qty: Math.min(dto.qty, 1000), installation: false },
        { ...(await this.pricing.currentRules()), maxQty: Number.MAX_SAFE_INTEGER },
      );
      estimatePaise = estimate.status === 'OK' ? estimate.payablePaise : null;
    }

    const previewKey = await this.designs.storePreview(dto.preview);
    const territory = await this.prisma.franchiseTerritory.findUnique({
      where: { pincode: dto.pincode },
      select: { franchiseId: true },
    });
    const details: RequestDetails = {
      kind: dto.kind,
      widthIn: dto.design?.widthIn ?? dto.widthIn ?? null,
      heightIn: dto.design?.heightIn ?? dto.heightIn ?? null,
      qty: dto.qty,
      pincode: dto.pincode,
      installation: dto.installation,
      message: dto.message || null,
      logoKey,
      referenceKey: dto.design ? null : previewKey,
      estimatePaise,
    };

    const quote = await this.prisma.$transaction(async (tx) => {
      const design = dto.design
        ? await this.designs.create(tx, userId, dto.design, { previewKey, saved: false })
        : null;
      return tx.quotation.create({
        data: {
          quoteNo: await nextQuoteNo(tx),
          customerId: userId,
          franchiseId: territory?.franchiseId ?? null,
          designId: design?.id,
          requestDetails: details as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.notifications.notify(
      userId,
      {
        kind: 'quote.requested',
        title: `Quotation request ${quote.quoteNo} received`,
        body: 'Our team will send your quotation within one working day.',
        link: `/account/quotes/${quote.id}`,
      },
      ['customer'],
    );
    return { id: quote.id, quoteNo: quote.quoteNo };
  }

  /** The latest version of each of the customer's quotations. */
  async list(userId: string) {
    const quotes = await this.prisma.quotation.findMany({
      where: { customerId: userId },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
      include,
    });
    const latest = new Map<string, QuotationWithItems>();
    for (const quote of quotes) {
      const seen = latest.get(quote.quoteNo);
      if (!seen || quote.version > seen.version) latest.set(quote.quoteNo, quote);
    }
    return [...latest.values()].map((quote) => this.toView(quote));
  }

  async detail(userId: string, id: string) {
    return this.toView(await this.load(userId, id));
  }

  async respond(userId: string, id: string, dto: QuoteResponseDto) {
    const quote = await this.load(userId, id);
    await this.assertOpen(quote);

    await this.prisma.quotation.update({
      where: { id },
      data: {
        status: dto.decision === 'CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED',
        notes: [quote.notes, dto.comment && `Customer: ${dto.comment}`].filter(Boolean).join('\n\n') || null,
        respondedAt: new Date(),
      },
    });
    return this.detail(userId, id);
  }

  /** Accepting turns the quotation into a confirmed cash-on-delivery order at the quoted price. */
  async accept(userId: string, id: string, dto: AcceptQuoteDto) {
    const quote = await this.load(userId, id);
    await this.assertOpen(quote);

    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!address)
      throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', title: 'Choose a delivery address' });

    // GST follows the delivery state, which the quote could not know when it was written.
    const rules = await this.pricing.currentRules();
    const taxable = paise(quote.taxablePaise);
    const intraState = address.stateCode === rules.companyStateCode;
    const half = roundHalfUp((taxable * rules.gstRatePct) / 200);
    const igst = intraState ? 0 : roundHalfUp((taxable * rules.gstRatePct) / 100);
    const total = taxable + (intraState ? half * 2 : igst);
    const payable = roundHalfUp(total / 100) * 100;
    const details = quote.requestDetails as unknown as RequestDetails | null;
    const snapshot = addressSnapshot(address);

    const orderNo = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.quotation.updateMany({
        where: { id, status: 'SENT' },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      if (!count)
        throw new ConflictException({ code: 'QUOTE_CHANGED', title: 'This quotation was just updated' });

      const orderNo = await nextOrderNo(tx);
      const order = await tx.order.create({
        data: {
          orderNo,
          customerId: userId,
          channel: 'QUOTE',
          quotationId: quote.id,
          franchiseId: quote.franchiseId,
          attributionSource: quote.franchiseId ? 'ASSIGNED' : 'NONE',
          subtotalPaise: quote.subtotalPaise,
          discountPaise: quote.discountPaise,
          taxablePaise: quote.taxablePaise,
          cgstPaise: BigInt(intraState ? half : 0),
          sgstPaise: BigInt(intraState ? half : 0),
          igstPaise: BigInt(igst),
          roundOffPaise: BigInt(payable - total),
          totalPaise: BigInt(payable),
          amountDuePaise: BigInt(payable),
          paymentMode: 'COD',
          advanceRequiredPaise: 0n,
          shippingAddress: snapshot,
          billingAddress: snapshot,
          placeOfSupplyState: address.stateCode,
          customerGstin: address.gstin,
          pricingSnapshot: {
            quoteNo: quote.quoteNo,
            version: quote.version,
            rateCardVersion: rules.rateCardVersion,
          },
          installationRequired: details?.installation ?? false,
          items: {
            create: quote.items.map((item, i) => ({
              designId: i === 0 ? quote.designId : null,
              description: item.description,
              widthIn: item.widthIn ?? 0,
              heightIn: item.heightIn ?? 0,
              areaSqft: item.areaSqft ?? 0,
              billableSqft: item.areaSqft ?? 0,
              ratePerSqft: item.ratePerSqft ?? 0,
              qty: item.qty,
              unitPricePaise: item.qty ? item.amountPaise / BigInt(item.qty) : item.amountPaise,
              lineTaxablePaise: item.amountPaise,
            })),
          },
        },
      });
      await this.workflow.confirm(tx, await this.workflow.load(tx, order.id), userId, {
        note: `Quotation ${quote.quoteNo} accepted, cash on delivery`,
        actorType: 'CUSTOMER',
      });
      return orderNo;
    });

    await this.notifications.notify(
      userId,
      {
        kind: 'order.placed',
        title: `Order ${orderNo} placed`,
        body: `${formatINR(payable)} from quotation ${quote.quoteNo}. Pay in cash when it arrives.`,
        link: `/orders/${orderNo}`,
      },
      ['customer'],
    );
    return { orderNo };
  }

  private async assertOpen(quote: QuotationWithItems) {
    const newer = await this.prisma.quotation.count({
      where: { quoteNo: quote.quoteNo, version: { gt: quote.version } },
    });
    if (newer) {
      throw new ConflictException({
        code: 'QUOTE_SUPERSEDED',
        title: 'We have sent a newer version of this quotation. Open it from your quotations.',
      });
    }
    if (quote.status !== 'SENT') {
      throw new ConflictException({
        code: 'QUOTE_NOT_OPEN',
        title: 'This quotation is not open for a response',
      });
    }
    if (quote.validUntil && quote.validUntil < new Date()) {
      throw new ConflictException({
        code: 'QUOTE_EXPIRED',
        title: 'This quotation has expired. Ask for changes and we will send a fresh one.',
      });
    }
  }

  private async load(userId: string, id: string) {
    const quote = await this.prisma.quotation.findFirst({ where: { id, customerId: userId }, include });
    if (!quote) throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', title: 'Quotation not found' });
    return quote;
  }

  private toView(quote: QuotationWithItems) {
    const details = quote.requestDetails as unknown as RequestDetails | null;
    const priced = ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CHANGES_REQUESTED'].includes(quote.status);
    const expired = quote.status === 'SENT' && quote.validUntil !== null && quote.validUntil < new Date();

    return {
      id: quote.id,
      quoteNo: quote.quoteNo,
      version: quote.version,
      status: expired ? ('EXPIRED' as const) : quote.status,
      requestedAt: quote.createdAt,
      request: details && {
        kind: details.kind,
        widthIn: details.widthIn,
        heightIn: details.heightIn,
        qty: details.qty,
        pincode: details.pincode,
        installation: details.installation,
        message: details.message,
      },
      previewUrl: this.storage.url(quote.design?.previewKey),
      lettering: letteringOf(quote.design?.config),
      logoUrl: this.storage.url(details?.logoKey),
      referenceUrl: this.storage.url(details?.referenceKey),
      items:
        priced && quote.sentAt
          ? quote.items.map((item) => ({
              id: item.id,
              description: item.description,
              widthIn: item.widthIn && Number(item.widthIn),
              heightIn: item.heightIn && Number(item.heightIn),
              qty: item.qty,
              amountPaise: paise(item.amountPaise),
            }))
          : [],
      totals:
        priced && quote.sentAt
          ? {
              subtotalPaise: paise(quote.subtotalPaise),
              discountPaise: paise(quote.discountPaise),
              taxablePaise: paise(quote.taxablePaise),
              gstPaise: paise(quote.cgstPaise + quote.sgstPaise + quote.igstPaise),
              totalPaise: paise(quote.totalPaise),
            }
          : null,
      validUntil: quote.validUntil,
      terms: quote.terms,
      sentAt: quote.sentAt,
      orderNo: quote.orders[0]?.orderNo ?? null,
    };
  }
}
