import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OPEN_STATUSES } from '@neon-adda/shared';
import { Prisma } from '@prisma/client';
import { pageOf, skipTake } from '../../common/http/pagination';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { translateUnique } from '../admin/pricing/admin-pricing.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AddressSnapshot } from '../orders/address-snapshot';
import { StorageService } from '../storage/storage.service';
import {
  PartnerInstallationDto,
  PartnerLeadListQuery,
  PartnerLeadUpdateDto,
  PartnerOrderListQuery,
  PartnerTechnicianDto,
} from './partner.dto';

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
        duePaise: earned(['ELIGIBLE', 'APPROVED']),
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
          items: { orderBy: { id: 'asc' }, include: { design: { select: { previewKey: true } } } },
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
    const technicians = order.installationRequired
      ? await this.prisma.technician.findMany({
          where: { franchiseId, isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : [];

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
      technicians,
      commission: order.commissions.map((c) => ({ status: c.status, amountPaise: paise(c.amountPaise) })),
    };
  }

  async scheduleInstallation(
    actorId: string,
    franchiseId: string,
    orderNo: string,
    dto: PartnerInstallationDto,
    meta: RequestMeta,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { orderNo, franchiseId },
      include: { installationJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order)
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'This order is not assigned to you' });
    if (!order.installationRequired) {
      throw new ConflictException({
        code: 'NO_INSTALLATION',
        title: 'Installation was not booked for this order',
      });
    }
    if (['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'INSTALLED'].includes(order.status)) {
      throw new ConflictException({
        code: 'ORDER_CLOSED',
        title: 'This order does not need an installation slot now',
      });
    }
    const job = order.installationJobs[0];
    if (job && ['ON_THE_WAY', 'REACHED', 'WORK_STARTED'].includes(job.status)) {
      throw new ConflictException({
        code: 'VISIT_UNDER_WAY',
        title: 'The technician is already on this visit',
      });
    }

    const technician = dto.technicianId
      ? await this.prisma.technician.findFirst({
          where: { id: dto.technicianId, franchiseId, isActive: true },
        })
      : null;
    if (dto.technicianId && !technician) {
      throw new UnprocessableEntityException({
        code: 'TECHNICIAN_UNAVAILABLE',
        title: 'Choose one of your active technicians',
        field: 'technicianId',
      });
    }

    const start = dto.scheduledStart;
    const end = start ? new Date(start.getTime() + dto.durationHours * 3600_000) : null;
    const rescheduled = Boolean(
      job?.scheduledStart && start && job.scheduledStart.getTime() !== start.getTime(),
    );
    const data = {
      technicianId: technician?.id ?? null,
      scheduledStart: start,
      scheduledEnd: end,
      notes: dto.notes ?? null,
      failReason: null,
      status:
        technician && start
          ? rescheduled
            ? ('RESCHEDULED' as const)
            : ('SCHEDULED' as const)
          : ('UNASSIGNED' as const),
    };

    await this.prisma.$transaction(async (tx) => {
      if (job) await tx.installationJob.update({ where: { id: job.id }, data });
      else await tx.installationJob.create({ data: { ...data, orderId: order.id, franchiseId } });
      await this.audit.record(
        {
          actorId,
          action: 'order.installation-scheduled',
          entity: 'order',
          entityId: order.id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });

    if (technician && start) {
      const when = new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(start);
      await this.notifications.notify(
        order.customerId,
        {
          kind: 'order.updated',
          title: 'Installation booked',
          body: `${technician.name} will come on ${when}.`,
          link: `/orders/${orderNo}`,
        },
        ['customer'],
      );
      if (technician.userId) {
        await this.notifications.notify(
          technician.userId,
          { kind: 'job.assigned', title: 'New installation', body: `${orderNo} on ${when}`, link: '/' },
          ['technician'],
        );
      }
    }
    return this.order(franchiseId, orderNo);
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

  async technicians(franchiseId: string) {
    const technicians = await this.prisma.technician.findMany({
      where: { franchiseId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { jobs: { where: { status: 'COMPLETED' } } } },
        jobs: {
          where: { status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
          select: { id: true },
        },
      },
    });
    return technicians.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      isActive: t.isActive,
      completedJobs: t._count.jobs,
      openJobs: t.jobs.length,
    }));
  }

  async saveTechnician(
    actorId: string,
    franchiseId: string,
    technicianId: string | null,
    dto: PartnerTechnicianDto,
    meta: RequestMeta,
  ) {
    if (technicianId) {
      const owned = await this.prisma.technician.count({ where: { id: technicianId, franchiseId } });
      if (!owned)
        throw new NotFoundException({ code: 'TECHNICIAN_NOT_FOUND', title: 'Technician not found' });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const technician = technicianId
          ? await tx.technician.update({ where: { id: technicianId }, data: dto })
          : await tx.technician.create({ data: { ...dto, franchiseId } });
        await this.audit.record(
          {
            actorId,
            action: technicianId ? 'technician.updated' : 'technician.added',
            entity: 'franchise',
            entityId: franchiseId,
            after: { technicianId: technician.id, ...dto },
            ...meta,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateUnique(error, 'This mobile number is already registered to a technician');
    }
    return this.technicians(franchiseId);
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
    const [entries, payouts] = await Promise.all([
      this.prisma.commission.findMany({
        where: { franchiseId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { order: { select: { orderNo: true, status: true } } },
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
