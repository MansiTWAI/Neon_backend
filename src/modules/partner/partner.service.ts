import { Injectable, NotFoundException } from '@nestjs/common';
import { OPEN_STATUSES } from '@neon-adda/shared';
import { Prisma } from '@prisma/client';
import { pageOf, skipTake } from '../../common/http/pagination';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { promoteEligibleCommission } from '../claims/commission-ledger';
import { NotificationsService } from '../notifications/notifications.service';
import type { AddressSnapshot } from '../orders/address-snapshot';
import { letteringOf } from '../designs/design.dto';
import { StorageService } from '../storage/storage.service';
import { PartnerLeadListQuery, PartnerLeadUpdateDto, PartnerOrderListQuery } from './partner.dto';

const paise = (value: bigint | null | undefined) => Number(value ?? 0n);

const QUEUES: Record<PartnerOrderListQuery['queue'], Prisma.OrderWhereInput> = {
  open: { status: { in: [...OPEN_STATUSES] } },
  installation: {
    installationRequired: true,
    status: {
      in: [
        'CONFIRMED',
        'PROOF_PENDING',
        'PROOF_APPROVED',
        'IN_PRODUCTION',
        'QUALITY_CHECK',
        'READY_TO_DISPATCH',
        'SHIPPED',
        'DELIVERED',
      ],
    },
  },
  'cash-to-collect': { amountDuePaise: { gt: 0 }, status: { in: ['SHIPPED', 'DELIVERED', 'INSTALLED'] } },
  closed: { status: { in: ['COMPLETED', 'CANCELLED', 'EXPIRED'] } },
  all: {},
};

const IST_OFFSET_MS = 5.5 * 3600_000;

/** Start of the current calendar day in India, as a UTC instant. */
function startOfTodayInIndia(now = new Date()): Date {
  return new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS);
}

/** "+919876543210" → "+91 98xxxxxx10", for partners not cleared to see full contacts. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+91/, '');
  return digits.length === 10 ? `+91 ${digits.slice(0, 2)}xxxxxx${digits.slice(8)}` : phone;
}

/** Everything a franchise sees, always filtered to its own id. */
@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async overview(franchiseId: string) {
    await promoteEligibleCommission(this.prisma);
    const today = startOfTodayInIndia();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const [openOrders, toSchedule, visitsToday, newLeads, cashToCollect, commission] = await Promise.all([
      this.prisma.order.count({ where: { franchiseId, ...QUEUES.open } }),
      this.prisma.installationJob.count({
        where: {
          franchiseId,
          status: { in: ['UNASSIGNED', 'FAILED'] },
          order: { status: { notIn: ['CANCELLED', 'EXPIRED', 'COMPLETED', 'INSTALLED'] } },
        },
      }),
      this.prisma.installationJob.findMany({
        where: {
          franchiseId,
          scheduledStart: { gte: today, lt: tomorrow },
          status: { notIn: ['CANCELLED'] },
        },
        orderBy: { scheduledStart: 'asc' },
        include: {
          technician: { select: { name: true } },
          order: { select: { orderNo: true, shippingAddress: true } },
        },
      }),
      this.prisma.lead.count({ where: { franchiseId, status: 'NEW' } }),
      this.prisma.order.aggregate({
        where: { franchiseId, ...QUEUES['cash-to-collect'] },
        _sum: { amountDuePaise: true },
        _count: true,
      }),
      this.prisma.commission.groupBy({
        by: ['status'],
        where: { franchiseId, status: { not: 'REVERSED' } },
        _sum: { amountPaise: true },
      }),
    ]);
    const earned = (statuses: string[]) =>
      commission
        .filter((c) => statuses.includes(c.status))
        .reduce((sum, c) => sum + paise(c._sum.amountPaise), 0);

    return {
      openOrders,
      toSchedule,
      newLeads,
      cashToCollect: { orders: cashToCollect._count, amountPaise: paise(cashToCollect._sum.amountDuePaise) },
      commission: {
        pendingPaise: earned(['PENDING', 'ON_HOLD']),
        /** Eligible and not yet claimed: what the partner can put in a claim now. */
        claimablePaise: earned(['ELIGIBLE']),
        claimedPaise: earned(['CLAIMED', 'DISPUTED']),
        duePaise: earned(['ELIGIBLE', 'CLAIMED', 'DISPUTED', 'APPROVED']),
        paidPaise: earned(['PAID']),
      },
      visitsToday: visitsToday.map((job) => ({
        id: job.id,
        status: job.status,
        scheduledStart: job.scheduledStart,
        technician: job.technician?.name ?? null,
        orderNo: job.order.orderNo,
        city: (job.order.shippingAddress as AddressSnapshot).city,
      })),
    };
  }

  async orders(franchiseId: string, query: PartnerOrderListQuery) {
    const where: Prisma.OrderWhereInput = {
      franchiseId,
      ...QUEUES[query.queue],
      ...(query.q
        ? {
            OR: [
              { orderNo: { contains: query.q, mode: 'insensitive' } },
              { customer: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        select: {
          orderNo: true,
          status: true,
          paymentStatus: true,
          channel: true,
          attributionSource: true,
          totalPaise: true,
          amountDuePaise: true,
          installationRequired: true,
          createdAt: true,
          shippingAddress: true,
          items: { select: { qty: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return pageOf(
      orders.map(({ items, totalPaise, amountDuePaise, shippingAddress, ...order }) => {
        const address = shippingAddress as AddressSnapshot;
        return {
          ...order,
          customerName: address.name,
          city: address.city,
          totalPaise: paise(totalPaise),
          duePaise: paise(amountDuePaise),
          signs: items.reduce((sum, item) => sum + item.qty, 0),
        };
      }),
      total,
      query,
    );
  }

  async order(franchiseId: string, orderNo: string) {
    const [order, franchise] = await Promise.all([
      this.prisma.order.findFirst({
        where: { orderNo, franchiseId },
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: { design: { select: { previewKey: true, config: true } } },
          },
          statusHistory: { orderBy: { createdAt: 'asc' } },
          installationJobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              technician: { select: { id: true, name: true } },
              photos: { orderBy: { createdAt: 'asc' } },
            },
          },
          commissions: { where: { status: { not: 'REVERSED' } } },
        },
      }),
      this.prisma.franchise.findUniqueOrThrow({
        where: { id: franchiseId },
        select: { showFullCustomerContact: true },
      }),
    ]);
    if (!order)
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'This order is not assigned to you' });

    const address = order.shippingAddress as AddressSnapshot;
    const job = order.installationJobs[0];
    return {
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMode: order.paymentMode,
      channel: order.channel,
      attributionSource: order.attributionSource,
      placedAt: order.createdAt,
      installationRequired: order.installationRequired,
      customer: {
        name: address.name,
        phone: franchise.showFullCustomerContact ? address.phone : maskPhone(address.phone),
        city: address.city,
        pincode: address.pincode,
        address: franchise.showFullCustomerContact
          ? [address.line1, address.line2, address.landmark, address.city, address.pincode]
              .filter(Boolean)
              .join(', ')
          : null,
      },
      items: order.items.map((item) => ({
        id: item.id,
        description: item.description,
        widthIn: Number(item.widthIn),
        heightIn: Number(item.heightIn),
        qty: item.qty,
        amountPaise: paise(item.lineTaxablePaise),
        previewUrl: this.storage.url(item.design?.previewKey),
        // The words, font and colours, so the sign can be drawn when there is no preview picture.
        lettering: letteringOf(item.design?.config),
      })),
      totals: {
        totalPaise: paise(order.totalPaise),
        paidPaise: paise(order.amountPaidPaise),
        duePaise: paise(order.amountDuePaise),
      },
      history: order.statusHistory.map((h) => ({ status: h.toStatus, note: h.note, at: h.createdAt })),
      installation: job && {
        status: job.status,
        technicianId: job.technicianId,
        technician: job.technician?.name ?? null,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        completedAt: job.completedAt,
        notes: job.notes,
        failReason: job.failReason,
        photos: job.photos.map((photo) => ({
          id: photo.id,
          stage: photo.stage,
          url: this.storage.url(photo.fileKey),
        })),
      },
      commission: order.commissions.map((c) => ({ status: c.status, amountPaise: paise(c.amountPaise) })),
    };
  }

  async installations(franchiseId: string) {
    const jobs = await this.prisma.installationJob.findMany({
      where: {
        franchiseId,
        status: { not: 'CANCELLED' },
        order: { status: { notIn: ['CANCELLED', 'EXPIRED'] } },
        OR: [
          { status: { notIn: ['COMPLETED', 'FAILED'] } },
          { updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        ],
      },
      orderBy: [{ scheduledStart: { sort: 'asc', nulls: 'first' } }],
      take: 200,
      include: {
        technician: { select: { name: true } },
        order: { select: { orderNo: true, status: true, shippingAddress: true } },
        _count: { select: { photos: true } },
      },
    });
    return jobs.map((job) => {
      const address = job.order.shippingAddress as AddressSnapshot;
      return {
        id: job.id,
        status: job.status,
        scheduledStart: job.scheduledStart,
        completedAt: job.completedAt,
        technician: job.technician?.name ?? null,
        orderNo: job.order.orderNo,
        orderStatus: job.order.status,
        customerName: address.name,
        city: address.city,
        pincode: address.pincode,
        photos: job._count.photos,
        failReason: job.failReason,
      };
    });
  }

  async leads(franchiseId: string, query: PartnerLeadListQuery) {
    const where: Prisma.LeadWhereInput = { franchiseId, ...(query.status ? { status: query.status } : {}) };
    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.lead.count({ where }),
    ]);
    return pageOf(
      leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        pincode: lead.pincode,
        message: lead.message,
        source: lead.source,
        status: lead.status,
        followUpAt: lead.followUpAt,
        createdAt: lead.createdAt,
      })),
      total,
      query,
    );
  }

  async updateLead(
    actorId: string,
    franchiseId: string,
    id: string,
    dto: PartnerLeadUpdateDto,
    meta: RequestMeta,
  ) {
    const lead = await this.prisma.lead.findFirst({ where: { id, franchiseId } });
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', title: 'Lead not found' });
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId,
          action: 'lead.updated',
          entity: 'lead',
          entityId: id,
          before: { status: lead.status },
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return { ok: true };
  }

  async commissionLedger(franchiseId: string) {
    await promoteEligibleCommission(this.prisma);
    const [entries, payouts] = await Promise.all([
      this.prisma.commission.findMany({
        where: { franchiseId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          order: { select: { orderNo: true, status: true } },
          claim: { select: { id: true, claimNo: true, status: true } },
        },
      }),
      this.prisma.payout.findMany({
        where: { franchiseId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      entries: entries.map((c) => ({
        id: c.id,
        orderNo: c.order.orderNo,
        orderStatus: c.order.status,
        source: c.source,
        basePaise: paise(c.basePaise),
        amountPaise: paise(c.amountPaise),
        status: c.status,
        eligibleAt: c.eligibleAt,
        createdAt: c.createdAt,
        claim: c.claim,
      })),
      payouts: payouts.map((p) => ({
        id: p.id,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        grossPaise: paise(p.grossPaise),
        tdsPaise: paise(p.tdsPaise),
        netPaise: paise(p.netPaise),
        status: p.status,
        utr: p.utr,
        paidAt: p.paidAt,
      })),
    };
  }
}
