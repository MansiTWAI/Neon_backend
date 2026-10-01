import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { roundHalfUp } from '@neon-adda/shared';
import { Prisma, QuotationStatus } from '@prisma/client';
import { z } from 'zod';
import { pageOf, pageSchema, searchSchema, skipTake } from '../../../common/http/pagination';
import { RequestMeta } from '../../../common/http/request-meta';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { letteringOf } from '../../designs/design.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { PricingService } from '../../pricing/pricing.service';
import { StorageService } from '../../storage/storage.service';

export const QUOTE_QUEUES = ['open', 'sent', 'closed', 'all'] as const;

export const quoteListSchema = pageSchema.extend({
  queue: z.enum(QUOTE_QUEUES).default('open').catch('open'),
  q: searchSchema,
});
export type QuoteListQuery = z.infer<typeof quoteListSchema>;

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);

export const saveQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        description: text(300),
        widthIn: z.number().positive().max(600).nullable().default(null),
        heightIn: z.number().positive().max(600).nullable().default(null),
        qty: z.number().int().min(1).max(10_000),
        /** Amount for the whole line, before GST. */
        amountPaise: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(1, 'Add at least one line')
    .max(30),
  discountPaise: z.number().int().min(0).default(0),
  validDays: z.number().int().min(1).max(90).default(15),
  terms: z.string().trim().max(2000).nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
});
export type SaveQuoteDto = z.infer<typeof saveQuoteSchema>;

const QUEUE_STATUSES: Record<(typeof QUOTE_QUEUES)[number], QuotationStatus[] | undefined> = {
  open: ['REQUESTED', 'IN_REVIEW', 'CHANGES_REQUESTED'],
  sent: ['SENT'],
  closed: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  all: undefined,
};

const include = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  franchise: { select: { name: true } },
  design: { select: { previewKey: true, config: true } },
  items: { orderBy: { id: 'asc' } },
  orders: { select: { orderNo: true }, take: 1 },
} satisfies Prisma.QuotationInclude;

type AdminQuote = Prisma.QuotationGetPayload<{ include: typeof include }>;

interface RequestDetails {
  kind: string;
  widthIn: number | null;
  heightIn: number | null;
  qty: number;
  pincode: string;
  installation: boolean;
  message: string | null;
  logoKey: string | null;
  estimatePaise: number | null;
}

const paise = (value: bigint) => Number(value);
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** One row per quotation number, showing its latest version. */
  async list(query: QuoteListQuery) {
    const statuses = QUEUE_STATUSES[query.queue];
    const superseded = await this.supersededIds();
    const digits = query.q?.replace(/\D/g, '') ?? '';
    const where: Prisma.QuotationWhereInput = {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(query.q
        ? {
            OR: [
              { quoteNo: { contains: query.q.toUpperCase() } },
              { customer: { name: { contains: query.q, mode: 'insensitive' } } },
              ...(digits.length >= 4 ? [{ customer: { phone: { contains: digits } } }] : []),
            ],
          }
        : {}),
      // A newer version of the same number supersedes this one.
      id: { notIn: superseded },
    };

    const [quotes, total, counts] = await Promise.all([
      this.prisma.quotation.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.quotation.count({ where }),
      Promise.all(
        QUOTE_QUEUES.map((queue) =>
          this.prisma.quotation.count({
            where: {
              id: { notIn: superseded },
              ...(QUEUE_STATUSES[queue] ? { status: { in: QUEUE_STATUSES[queue] } } : {}),
            },
          }),
        ),
      ),
    ]);

    return {
      ...pageOf(
        quotes.map((quote) => {
          const details = quote.requestDetails as unknown as RequestDetails | null;
          return {
            id: quote.id,
            quoteNo: quote.quoteNo,
            version: quote.version,
            status: quote.status,
            kind: details?.kind ?? 'CUSTOM',
            customer: quote.customer,
            franchise: quote.franchise?.name ?? null,
            totalPaise: quote.subtotalPaise > 0n ? paise(quote.totalPaise) : null,
            requestedAt: quote.createdAt,
            validUntil: quote.validUntil,
          };
        }),
        total,
        query,
      ),
      counts: Object.fromEntries(QUOTE_QUEUES.map((queue, i) => [queue, counts[i]])),
    };
  }

  async detail(id: string) {
    const quote = await this.load(id);
    const [versions, trail] = await Promise.all([
      this.prisma.quotation.findMany({
        where: { quoteNo: quote.quoteNo },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, status: true, totalPaise: true, sentAt: true, notes: true },
      }),
      this.audit.trail('quotation', quote.id),
    ]);
    return this.toView(quote, versions, trail);
  }

  /**
   * Saves the priced lines. A quotation the customer has already seen is never edited: a new
   * version is written instead, so what they saw stays on record.
   */
  async save(actorId: string, id: string, dto: SaveQuoteDto, meta: RequestMeta) {
    const quote = await this.load(id);
    if (['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(quote.status)) {
      throw new ConflictException({ code: 'QUOTE_CLOSED', title: 'This quotation is closed' });
    }
    await this.assertLatest(quote);

    const totals = await this.totals(dto, quote);
    const items = dto.items.map((item) => ({
      description: item.description,
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      areaSqft:
        item.widthIn && item.heightIn ? Math.ceil((item.widthIn * item.heightIn * 100) / 144) / 100 : null,
      ratePerSqft:
        item.widthIn && item.heightIn
          ? Math.round(item.amountPaise / item.qty / ((item.widthIn * item.heightIn) / 144)) / 100
          : null,
      qty: item.qty,
      amountPaise: BigInt(item.amountPaise),
    }));
    const fields = {
      ...totals,
      terms: dto.terms,
      notes: dto.notes,
      validUntil: new Date(Date.now() + dto.validDays * DAY),
    };

    const savedId = await this.prisma.$transaction(async (tx) => {
      let target = quote.id;
      if (quote.sentAt) {
        // An unanswered quotation that is being replaced can no longer be accepted.
        if (quote.status === 'SENT') {
          await tx.quotation.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } });
        }
        const next = await tx.quotation.create({
          data: {
            quoteNo: quote.quoteNo,
            version: quote.version + 1,
            customerId: quote.customerId,
            franchiseId: quote.franchiseId,
            leadId: quote.leadId,
            designId: quote.designId,
            requestDetails: quote.requestDetails ?? Prisma.JsonNull,
            status: 'IN_REVIEW',
            createdBy: actorId,
            ...fields,
            items: { create: items },
          },
        });
        target = next.id;
      } else {
        await tx.quotationItem.deleteMany({ where: { quotationId: quote.id } });
        await tx.quotation.update({
          where: { id: quote.id },
          data: { ...fields, status: 'IN_REVIEW', createdBy: actorId, items: { create: items } },
        });
      }
      await this.audit.record(
        { actorId, action: 'quotation.saved', entity: 'quotation', entityId: target, after: dto, ...meta },
        tx,
      );
      return target;
    });
    return this.detail(savedId);
  }

  async send(actorId: string, id: string, meta: RequestMeta) {
    const quote = await this.load(id);
    if (quote.status !== 'IN_REVIEW' || quote.items.length === 0) {
      throw new ConflictException({
        code: 'QUOTE_NOT_READY',
        title: 'Price the quotation and save it before sending',
      });
    }
    await this.assertLatest(quote);

    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
      await this.audit.record(
        { actorId, action: 'quotation.sent', entity: 'quotation', entityId: id, ...meta },
        tx,
      );
    });
    await this.notifications.notify(
      quote.customerId,
      {
        kind: 'quote.sent',
        title: `Your quotation ${quote.quoteNo} is ready`,
        body: 'Open it to accept, ask for changes or decline.',
        link: `/account/quotes/${id}`,
      },
      ['customer'],
    );
    return this.detail(id);
  }

  async decline(actorId: string, id: string, reason: string, meta: RequestMeta) {
    const quote = await this.load(id);
    if (!['REQUESTED', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(quote.status)) {
      throw new ConflictException({ code: 'QUOTE_NOT_OPEN', title: 'Only open requests can be declined' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id },
        data: {
          status: 'REJECTED',
          notes: [quote.notes, `Declined by Neon Adda: ${reason}`].filter(Boolean).join('\n\n'),
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'quotation.declined',
          entity: 'quotation',
          entityId: id,
          after: { reason },
          ...meta,
        },
        tx,
      );
    });
    await this.notifications.notify(
      quote.customerId,
      {
        kind: 'quote.declined',
        title: `About your request ${quote.quoteNo}`,
        body: reason,
        link: `/account/quotes/${id}`,
      },
      ['customer'],
    );
    return this.detail(id);
  }

  /** GST is worked out for the delivery state on the request; the customer's address confirms it on acceptance. */
  private async totals(dto: SaveQuoteDto, quote: AdminQuote) {
    const subtotal = dto.items.reduce((sum, item) => sum + item.amountPaise, 0);
    if (dto.discountPaise > subtotal) {
      throw new UnprocessableEntityException({
        code: 'DISCOUNT_TOO_LARGE',
        title: 'The discount is more than the quotation',
      });
    }
    const rules = await this.pricing.currentRules();
    const pincode = (quote.requestDetails as unknown as RequestDetails | null)?.pincode;
    const place = pincode ? await this.prisma.pincode.findUnique({ where: { pincode } }) : null;
    const intraState = !place || place.stateCode === rules.companyStateCode;

    const taxable = subtotal - dto.discountPaise;
    const half = roundHalfUp((taxable * rules.gstRatePct) / 200);
    const igst = intraState ? 0 : roundHalfUp((taxable * rules.gstRatePct) / 100);
    const total = taxable + (intraState ? half * 2 : igst);

    return {
      subtotalPaise: BigInt(subtotal),
      discountPaise: BigInt(dto.discountPaise),
      taxablePaise: BigInt(taxable),
      cgstPaise: BigInt(intraState ? half : 0),
      sgstPaise: BigInt(intraState ? half : 0),
      igstPaise: BigInt(igst),
      totalPaise: BigInt(roundHalfUp(total / 100) * 100),
    };
  }

  private async assertLatest(quote: AdminQuote) {
    const newer = await this.prisma.quotation.count({
      where: { quoteNo: quote.quoteNo, version: { gt: quote.version } },
    });
    if (newer)
      throw new ConflictException({
        code: 'QUOTE_SUPERSEDED',
        title: 'Open the latest version of this quotation',
      });
  }

  private async supersededIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM quotations q
      WHERE EXISTS (SELECT 1 FROM quotations n WHERE n."quoteNo" = q."quoteNo" AND n.version > q.version)`;
    return rows.map((row) => row.id);
  }

  private async load(id: string): Promise<AdminQuote> {
    const quote = await this.prisma.quotation.findUnique({ where: { id }, include });
    if (!quote) throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', title: 'Quotation not found' });
    return quote;
  }

  private toView(
    quote: AdminQuote,
    versions: {
      id: string;
      version: number;
      status: QuotationStatus;
      totalPaise: bigint;
      sentAt: Date | null;
      notes: string | null;
    }[],
    trail: Awaited<ReturnType<AuditService['trail']>>,
  ) {
    const details = quote.requestDetails as unknown as RequestDetails | null;
    return {
      id: quote.id,
      quoteNo: quote.quoteNo,
      version: quote.version,
      isLatest: versions[0]?.id === quote.id,
      status: quote.status,
      customer: quote.customer,
      franchise: quote.franchise?.name ?? null,
      requestedAt: quote.createdAt,
      request: details && {
        kind: details.kind,
        widthIn: details.widthIn,
        heightIn: details.heightIn,
        qty: details.qty,
        pincode: details.pincode,
        installation: details.installation,
        message: details.message,
        estimatePaise: details.estimatePaise,
      },
      design: quote.design?.config ?? null,
      lettering: letteringOf(quote.design?.config),
      previewUrl: this.storage.url(quote.design?.previewKey),
      logoUrl: this.storage.url(details?.logoKey),
      items: quote.items.map((item) => ({
        id: item.id,
        description: item.description,
        widthIn: item.widthIn && Number(item.widthIn),
        heightIn: item.heightIn && Number(item.heightIn),
        qty: item.qty,
        amountPaise: paise(item.amountPaise),
      })),
      totals: {
        subtotalPaise: paise(quote.subtotalPaise),
        discountPaise: paise(quote.discountPaise),
        taxablePaise: paise(quote.taxablePaise),
        cgstPaise: paise(quote.cgstPaise),
        sgstPaise: paise(quote.sgstPaise),
        igstPaise: paise(quote.igstPaise),
        totalPaise: paise(quote.totalPaise),
      },
      validUntil: quote.validUntil,
      terms: quote.terms,
      notes: quote.notes,
      sentAt: quote.sentAt,
      respondedAt: quote.respondedAt,
      orderNo: quote.orders[0]?.orderNo ?? null,
      versions: versions.map((v) => ({ ...v, totalPaise: v.sentAt ? paise(v.totalPaise) : null })),
      activity: trail.map((entry) => ({
        id: entry.id,
        action: entry.action,
        by: entry.actor?.name ?? entry.actor?.email ?? 'System',
        at: entry.createdAt,
      })),
    };
  }
}
