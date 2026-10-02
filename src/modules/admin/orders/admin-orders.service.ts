import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formatINR, STAFF_TRANSITIONS } from '@neon-adda/shared';
import { OrderStatus, Prisma } from '@prisma/client';
import { PageQuery, pageOf, skipTake } from '../../../common/http/pagination';
import { RequestMeta } from '../../../common/http/request-meta';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { letteringOf } from '../../designs/design.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { ImageType, StorageService } from '../../storage/storage.service';
import {
  InstallationDto,
  OrderListQuery,
  OrderQueue,
  ORDER_QUEUES,
  RecordPaymentDto,
  StatusChangeDto,
  TicketUpdateDto,
} from './admin-orders.dto';
import { OrderWorkflowService } from '../../order-workflow/order-workflow.service';

const paise = (value: bigint) => Number(value);

const QUEUE_FILTERS: Record<OrderQueue, Prisma.OrderWhereInput> = {
  all: {},
  // Cash on delivery still outstanding once the sign has gone out.
  'cash-to-collect': {
    amountDuePaise: { gt: 0 },
    status: { in: ['SHIPPED', 'DELIVERED', 'INSTALLED'] },
  },
  'needs-proof': {
    OR: [
      { status: 'CONFIRMED' },
      { status: 'PROOF_PENDING', items: { some: { proofStatus: 'CHANGES_REQUESTED' } } },
    ],
  },
  'with-customer': { status: 'PROOF_PENDING', items: { none: { proofStatus: 'CHANGES_REQUESTED' } } },
  production: { status: { in: ['PROOF_APPROVED', 'IN_PRODUCTION', 'QUALITY_CHECK'] } },
  dispatch: { status: { in: ['READY_TO_DISPATCH', 'SHIPPED'] } },
  installation: { installationRequired: true, status: 'DELIVERED' },
  'on-hold': { status: 'ON_HOLD' },
  support: { supportTickets: { some: { status: { in: ['OPEN', 'IN_PROGRESS'] } } } },
  closed: { status: { in: ['COMPLETED', 'CANCELLED', 'EXPIRED'] } },
};

/** Messages customers get when staff move their order on. */
const CUSTOMER_NOTICES: Partial<Record<OrderStatus, string>> = {
  IN_PRODUCTION: 'Your sign is being made.',
  SHIPPED: 'Your sign is on its way.',
  DELIVERED: 'Your sign has been delivered.',
  CANCELLED: 'Your order has been cancelled.',
};

const detailInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  franchise: { select: { id: true, name: true, code: true } },
  coupon: { select: { code: true } },
  items: {
    orderBy: { id: 'asc' },
    include: {
      design: { select: { previewKey: true, config: true } },
      proofs: { orderBy: { version: 'desc' } },
    },
  },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  commissions: { include: { franchise: { select: { name: true } } } },
  installationJobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { technician: true, photos: { orderBy: { createdAt: 'asc' } } },
  },
  invoices: { orderBy: { issuedAt: 'asc' } },
  supportTickets: { orderBy: { createdAt: 'desc' } },
  review: true,
} satisfies Prisma.OrderInclude;

type AdminOrder = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: OrderWorkflowService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: OrderListQuery) {
    const where: Prisma.OrderWhereInput = {
      AND: [
        QUEUE_FILTERS[query.queue],
        query.franchiseId ? { franchiseId: query.franchiseId } : {},
        query.q ? this.search(query.q) : {},
      ],
    };

    const [orders, total, counts] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        select: {
          orderNo: true,
          status: true,
          paymentStatus: true,
          channel: true,
          totalPaise: true,
          amountDuePaise: true,
          installationRequired: true,
          createdAt: true,
          customer: { select: { name: true, phone: true } },
          franchise: { select: { name: true } },
          items: { select: { qty: true, proofStatus: true } },
        },
      }),
      this.prisma.order.count({ where }),
      this.queueCounts(),
    ]);

    return {
      ...pageOf(
        orders.map(({ items, totalPaise, amountDuePaise, ...order }) => ({
          ...order,
          totalPaise: paise(totalPaise),
          duePaise: paise(amountDuePaise),
          signs: items.reduce((sum, item) => sum + item.qty, 0),
          changesRequested: items.some((item) => item.proofStatus === 'CHANGES_REQUESTED'),
        })),
        total,
        query as PageQuery,
      ),
      counts,
    };
  }

  async detail(orderNo: string) {
    const order = await this.load(orderNo);
    const [technicians, trail] = await Promise.all([
      order.installationRequired
        ? this.prisma.technician.findMany({
            where: { isActive: true, OR: [{ franchiseId: order.franchiseId }, { franchiseId: null }] },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, phone: true, franchise: { select: { name: true } } },
          })
        : [],
      this.audit.trail('order', order.id),
    ]);
    return this.toView(order, technicians, trail);
  }

  async changeStatus(actorId: string, orderNo: string, dto: StatusChangeDto, meta: RequestMeta) {
    const order = await this.load(orderNo);
    const allowed = await this.allowedMoves(order);
    if (!allowed.includes(dto.to)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        title: `An order that is ${label(order.status)} cannot be moved to ${label(dto.to)}`,
      });
    }
    // Cash on delivery is collected at the door, so only prepaid orders must be settled before dispatch.
    if (dto.to === 'SHIPPED' && order.paymentMode !== 'COD' && order.amountDuePaise > 0n) {
      throw new ConflictException({
        code: 'BALANCE_DUE',
        title: `Collect the balance of ${formatINR(paise(order.amountDuePaise))} before dispatch`,
      });
    }
    if (dto.to === 'COMPLETED' && order.amountDuePaise > 0n) {
      throw new ConflictException({
        code: 'BALANCE_DUE',
        title: `Record the ${formatINR(paise(order.amountDuePaise))} collected before completing the order`,
      });
    }
    if (dto.to === 'CANCELLED' && order.amountPaidPaise > 0n) {
      throw new ConflictException({
        code: 'REFUND_REQUIRED',
        title: 'This order has payments against it. Accounts must refund them before it can be cancelled.',
      });
    }
    if (dto.to === 'COMPLETED' && order.installationRequired && order.status !== 'INSTALLED') {
      throw new ConflictException({
        code: 'INSTALLATION_PENDING',
        title: 'Mark the installation done first',
      });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: dto.to,
          ...(dto.to === 'SHIPPED'
            ? { courierName: dto.courierName, awbNo: dto.awbNo, trackingUrl: dto.trackingUrl ?? null }
            : {}),
          ...(dto.to === 'CANCELLED' ? { cancelledAt: now, cancelReason: dto.note } : {}),
          ...(dto.to === 'COMPLETED' ? { completedAt: now } : {}),
        },
      });
      if (!count) throw changedMeanwhile();

      await this.workflow.history(tx, order.id, order.status, dto.to, actorId, dto.note);
      if (dto.to === 'SHIPPED') await this.workflow.issueInvoice(tx, order.id);
      if (dto.to === 'COMPLETED') await this.workflow.markCommissionEligible(tx, order.id);
      if (dto.to === 'CANCELLED' || dto.to === 'EXPIRED') await this.workflow.cancelWork(tx, order.id);
      if (dto.to === 'INSTALLED') {
        await tx.installationJob.updateMany({
          where: { orderId: order.id, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED', completedAt: now },
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'order.status-changed',
          entity: 'order',
          entityId: order.id,
          before: { status: order.status },
          after: dto,
          ...meta,
        },
        tx,
      );
    });

    const notice = CUSTOMER_NOTICES[dto.to];
    if (notice) await this.workflow.notifyCustomer(order.customerId, orderNo, `Order ${orderNo}`, notice);
    return this.detail(orderNo);
  }

  async recordPayment(actorId: string, orderNo: string, dto: RecordPaymentDto, meta: RequestMeta) {
    const order = await this.load(orderNo);
    if (order.status === 'CANCELLED') {
      throw new ConflictException({ code: 'ORDER_CANCELLED', title: 'This order is cancelled' });
    }
    if (BigInt(dto.amountPaise) > order.amountDuePaise) {
      throw new UnprocessableEntityException({
        code: 'OVERPAYMENT',
        title: `Only ${formatINR(paise(order.amountDuePaise), { paise: true })} is due on this order`,
      });
    }

    const firstPayment = order.amountPaidPaise === 0n;
    const paid = order.amountPaidPaise + BigInt(dto.amountPaise);
    const due = order.totalPaise - paid;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          purpose: firstPayment ? (due > 0n ? 'ADVANCE' : 'FULL') : 'BALANCE',
          method: dto.method,
          amountPaise: BigInt(dto.amountPaise),
          status: 'CAPTURED',
          reference: dto.reference,
          recordedBy: actorId,
          capturedAt: dto.receivedAt ?? new Date(),
        },
      });
      const { count } = await tx.order.updateMany({
        where: { id: order.id, amountPaidPaise: order.amountPaidPaise },
        data: {
          amountPaidPaise: paid,
          amountDuePaise: due,
          paymentStatus: due === 0n ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
      if (!count) throw changedMeanwhile();

      const awaiting = order.status === 'PENDING_PAYMENT' || order.status === 'EXPIRED';
      if (awaiting && paid >= order.advanceRequiredPaise) {
        await this.workflow.confirm(tx, await this.workflow.load(tx, order.id), actorId);
      }
      await this.audit.record(
        {
          actorId,
          action: 'order.payment-recorded',
          entity: 'order',
          entityId: order.id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });

    await this.workflow.notifyCustomer(
      order.customerId,
      orderNo,
      `Payment received for ${orderNo}`,
      `We received ${formatINR(dto.amountPaise, { paise: true })}. ${due > 0n ? `${formatINR(paise(due))} is still due.` : 'Your order is fully paid.'}`,
    );
    return this.detail(orderNo);
  }

  async sendProof(
    actorId: string,
    orderNo: string,
    itemId: string,
    file: { body: Buffer; type: ImageType },
    designerNote: string | undefined,
    meta: RequestMeta,
  ) {
    const order = await this.load(orderNo);
    const item = order.items.find((i) => i.id === itemId);
    if (!item)
      throw new NotFoundException({ code: 'ITEM_NOT_FOUND', title: 'This sign is not on the order' });
    if (order.status !== 'CONFIRMED' && order.status !== 'PROOF_PENDING') {
      throw new ConflictException({
        code: 'PROOF_NOT_EXPECTED',
        title:
          order.status === 'PENDING_PAYMENT'
            ? 'Proofs are sent once the order is paid'
            : 'The design for this order is already approved',
      });
    }
    if (item.proofStatus === 'APPROVED') {
      throw new ConflictException({
        code: 'PROOF_APPROVED',
        title: 'The customer has already approved this sign',
      });
    }

    const fileKey = await this.storage.put('proofs', file.body, file.type);
    const version = (item.proofs[0]?.version ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.designProof.updateMany({
        where: { orderItemId: item.id, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
        data: { status: 'SUPERSEDED' },
      });
      await tx.designProof.create({
        data: {
          orderItemId: item.id,
          version,
          fileKey,
          designerNote: designerNote || null,
          uploadedBy: actorId,
        },
      });
      await tx.orderItem.update({ where: { id: item.id }, data: { proofStatus: 'PENDING' } });
      if (order.status === 'CONFIRMED') {
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: 'CONFIRMED' },
          data: { status: 'PROOF_PENDING' },
        });
        if (!count) throw changedMeanwhile();
        await this.workflow.history(tx, order.id, 'CONFIRMED', 'PROOF_PENDING', actorId, 'Design proof sent');
      }
      await this.audit.record(
        {
          actorId,
          action: 'order.proof-sent',
          entity: 'order',
          entityId: order.id,
          after: { itemId, version, designerNote },
          ...meta,
        },
        tx,
      );
    });

    await this.workflow.notifyCustomer(
      order.customerId,
      orderNo,
      'Your design proof is ready',
      'Have a look and approve it, or tell us what to change.',
    );
    return this.detail(orderNo);
  }

  async scheduleInstallation(actorId: string, orderNo: string, dto: InstallationDto, meta: RequestMeta) {
    const order = await this.load(orderNo);
    if (!order.installationRequired) {
      throw new ConflictException({
        code: 'NO_INSTALLATION',
        title: 'Installation was not booked for this order',
      });
    }
    if (['CANCELLED', 'EXPIRED', 'COMPLETED', 'INSTALLED'].includes(order.status)) {
      throw new ConflictException({
        code: 'ORDER_CLOSED',
        title: 'This order no longer needs an installation slot',
      });
    }

    const technician = dto.technicianId
      ? await this.prisma.technician.findFirst({
          where: {
            id: dto.technicianId,
            isActive: true,
            OR: [{ franchiseId: order.franchiseId }, { franchiseId: null }],
          },
        })
      : null;
    if (dto.technicianId && !technician) {
      throw new UnprocessableEntityException({
        code: 'TECHNICIAN_UNAVAILABLE',
        title: 'Choose a technician from the franchise handling this order',
      });
    }

    const job = order.installationJobs[0];
    const start = dto.scheduledStart;
    const end = start ? new Date(start.getTime() + dto.durationHours * 60 * 60 * 1000) : null;
    const rescheduled = Boolean(
      job?.scheduledStart && start && job.scheduledStart.getTime() !== start.getTime(),
    );
    const data = {
      technicianId: technician?.id ?? null,
      scheduledStart: start,
      scheduledEnd: end,
      notes: dto.notes ?? null,
      status:
        technician && start
          ? rescheduled
            ? ('RESCHEDULED' as const)
            : ('SCHEDULED' as const)
          : ('UNASSIGNED' as const),
    };

    await this.prisma.$transaction(async (tx) => {
      if (job) await tx.installationJob.update({ where: { id: job.id }, data });
      else
        await tx.installationJob.create({
          data: { ...data, orderId: order.id, franchiseId: order.franchiseId },
        });
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
      await this.workflow.notifyCustomer(
        order.customerId,
        orderNo,
        'Installation booked',
        `${technician.name} will come on ${when}.`,
      );
      if (technician.userId) {
        await this.notifications.notify(
          technician.userId,
          { kind: 'job.assigned', title: 'New installation', body: `${orderNo} on ${when}`, link: '/' },
          ['technician'],
        );
      }
    }
    return this.detail(orderNo);
  }

  async updateTicket(
    actorId: string,
    orderNo: string,
    ticketId: string,
    dto: TicketUpdateDto,
    meta: RequestMeta,
  ) {
    const order = await this.load(orderNo);
    const ticket = order.supportTickets.find((t) => t.id === ticketId);
    if (!ticket) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', title: 'Request not found' });
    if ((dto.status === 'RESOLVED' || dto.status === 'CLOSED') && !dto.resolution && !ticket.resolution) {
      throw new BadRequestException({ code: 'RESOLUTION_REQUIRED', title: 'Say how it was resolved' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: dto.status, ...(dto.resolution ? { resolution: dto.resolution } : {}) },
      });
      await this.audit.record(
        {
          actorId,
          action: 'order.ticket-updated',
          entity: 'order',
          entityId: order.id,
          before: { status: ticket.status },
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    if (dto.status === 'RESOLVED' && dto.resolution) {
      await this.workflow.notifyCustomer(
        order.customerId,
        orderNo,
        'Your request is resolved',
        dto.resolution.slice(0, 140),
      );
    }
    return this.detail(orderNo);
  }

  async queueCounts(): Promise<Record<OrderQueue, number>> {
    const counts = await Promise.all(
      ORDER_QUEUES.map((queue) => this.prisma.order.count({ where: QUEUE_FILTERS[queue] })),
    );
    return Object.fromEntries(ORDER_QUEUES.map((queue, i) => [queue, counts[i]!])) as Record<
      OrderQueue,
      number
    >;
  }

  private search(q: string): Prisma.OrderWhereInput {
    const digits = q.replace(/\D/g, '');
    return {
      OR: [
        { orderNo: { contains: q.toUpperCase() } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        ...(digits.length >= 4 ? [{ customer: { phone: { contains: digits } } }] : []),
      ],
    };
  }

  /** The moves the screen offers. Resuming from hold returns the order to where it was. */
  private async allowedMoves(order: AdminOrder): Promise<OrderStatus[]> {
    if (order.status === 'ON_HOLD') {
      const held = [...order.statusHistory].reverse().find((h) => h.toStatus === 'ON_HOLD');
      return [
        ...(held?.fromStatus ? [held.fromStatus] : []),
        ...(order.amountPaidPaise === 0n ? ['CANCELLED' as const] : []),
      ];
    }
    return (STAFF_TRANSITIONS[order.status] ?? []).filter((to) => {
      if (order.status === 'DELIVERED')
        return order.installationRequired ? to === 'INSTALLED' : to === 'COMPLETED';
      if (to === 'CANCELLED') return order.amountPaidPaise === 0n;
      return true;
    }) as OrderStatus[];
  }

  private async load(orderNo: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { orderNo }, include: detailInclude });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'Order not found' });
    return order;
  }

  private async toView(
    order: AdminOrder,
    technicians: { id: string; name: string; phone: string; franchise: { name: string } | null }[],
    trail: Awaited<ReturnType<AuditService['trail']>>,
  ) {
    const job = order.installationJobs[0];
    return {
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMode: order.paymentMode,
      channel: order.channel,
      placedAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      expiresAt: order.expiresAt,
      cancelReason: order.cancelReason,
      installationRequired: order.installationRequired,
      customer: order.customer,
      franchise: order.franchise && { ...order.franchise, source: order.attributionSource },
      coupon: order.coupon?.code ?? null,
      allowedMoves: await this.allowedMoves(order),
      items: order.items.map((item) => ({
        id: item.id,
        description: item.description,
        widthIn: Number(item.widthIn),
        heightIn: Number(item.heightIn),
        billableSqft: Number(item.billableSqft),
        ratePerSqftPaise: Math.round(Number(item.ratePerSqft) * 100),
        qty: item.qty,
        addons: item.addons,
        amountPaise: paise(item.lineTaxablePaise),
        previewUrl: this.storage.url(item.design?.previewKey),
        lettering: letteringOf(item.design?.config),
        design: item.design?.config ?? null,
        proofStatus: item.proofStatus,
        revisionsUsed: item.revisionsUsed,
        proofs: item.proofs.map((proof) => ({
          id: proof.id,
          version: proof.version,
          imageUrl: this.storage.url(proof.fileKey),
          designerNote: proof.designerNote,
          status: proof.status,
          customerComment: proof.customerComment,
          sentAt: proof.createdAt,
          respondedAt: proof.respondedAt,
        })),
      })),
      totals: {
        itemsPaise: paise(order.subtotalPaise),
        installationPaise: paise(order.installationPaise),
        deliveryPaise: paise(order.deliveryPaise),
        discountPaise: paise(order.discountPaise),
        taxablePaise: paise(order.taxablePaise),
        cgstPaise: paise(order.cgstPaise),
        sgstPaise: paise(order.sgstPaise),
        igstPaise: paise(order.igstPaise),
        roundOffPaise: paise(order.roundOffPaise),
        totalPaise: paise(order.totalPaise),
        paidPaise: paise(order.amountPaidPaise),
        duePaise: paise(order.amountDuePaise),
        advanceRequiredPaise: paise(order.advanceRequiredPaise),
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      customerGstin: order.customerGstin,
      shipment: { courierName: order.courierName, awbNo: order.awbNo, trackingUrl: order.trackingUrl },
      payments: order.payments.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        method: p.method,
        status: p.status,
        amountPaise: paise(p.amountPaise),
        reference: p.reference ?? p.gatewayPaymentId,
        at: p.capturedAt ?? p.createdAt,
      })),
      commissions: order.commissions.map((c) => ({
        id: c.id,
        franchise: c.franchise.name,
        basePaise: paise(c.basePaise),
        amountPaise: paise(c.amountPaise),
        status: c.status,
        eligibleAt: c.eligibleAt,
      })),
      installation: job && {
        status: job.status,
        technicianId: job.technicianId,
        technician: job.technician && { name: job.technician.name, phone: job.technician.phone },
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
      technicians: technicians.map((t) => ({
        id: t.id,
        name: t.name,
        phone: t.phone,
        franchise: t.franchise?.name ?? null,
      })),
      invoices: order.invoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        type: invoice.type,
        issuedAt: invoice.issuedAt,
      })),
      tickets: order.supportTickets.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        status: t.status,
        resolution: t.resolution,
        at: t.createdAt,
      })),
      review: order.review && { rating: order.review.rating, comment: order.review.comment },
      history: order.statusHistory.map((h) => ({
        status: h.toStatus,
        note: h.note,
        actorType: h.actorType,
        at: h.createdAt,
      })),
      activity: trail.map((entry) => ({
        id: entry.id,
        action: entry.action,
        by: entry.actor?.name ?? entry.actor?.email ?? 'System',
        at: entry.createdAt,
      })),
    };
  }
}

function changedMeanwhile() {
  return new ConflictException({
    code: 'ORDER_CHANGED',
    title: 'Someone else just updated this order. Reload it.',
  });
}

const label = (status: OrderStatus) => status.toLowerCase().replace(/_/g, ' ');
