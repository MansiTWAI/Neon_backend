import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CUSTOMER_CANCELLABLE, REVIEWABLE } from '@neon-adda/shared';
import { Prisma } from '@prisma/client';
import { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { letteringOf } from '../designs/design.dto';
import { completionCode } from '../field-service/completion-code';
import { OrderWorkflowService } from '../order-workflow/order-workflow.service';
import { StorageService } from '../storage/storage.service';
import { CancelOrderDto, ProofDecisionDto, ReviewDto, TicketDto } from './orders.dto';

/** Rounds of proof changes included with every sign. */
export const FREE_REVISIONS = 3;

const OPEN_TICKET = ['OPEN', 'IN_PROGRESS'];
const paise = (value: bigint) => Number(value);

const detailInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      design: { select: { previewKey: true, config: true } },
      proofs: { orderBy: { version: 'desc' } },
    },
  },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  installationJobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { technician: { select: { name: true } } },
  },
  invoices: { where: { type: 'TAX_INVOICE' }, orderBy: { issuedAt: 'asc' } },
  review: true,
  supportTickets: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly workflow: OrderWorkflowService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        orderNo: true,
        status: true,
        paymentStatus: true,
        totalPaise: true,
        amountDuePaise: true,
        createdAt: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            description: true,
            qty: true,
            proofStatus: true,
            design: { select: { previewKey: true, config: true } },
          },
        },
      },
    });

    return orders.map((order) => ({
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalPaise: paise(order.totalPaise),
      amountDuePaise: paise(order.amountDuePaise),
      placedAt: order.createdAt,
      signs: order.items.reduce((sum, item) => sum + item.qty, 0),
      title: order.items[0]?.description ?? '',
      previewUrl: this.storage.url(order.items[0]?.design?.previewKey),
      lettering: letteringOf(order.items[0]?.design?.config),
      awaitingProof:
        order.status === 'PROOF_PENDING' && order.items.some((item) => item.proofStatus === 'PENDING'),
    }));
  }

  async detail(userId: string, orderNo: string) {
    return this.toView(await this.load(userId, orderNo));
  }

  async cancel(userId: string, orderNo: string, dto: CancelOrderDto) {
    const order = await this.load(userId, orderNo);
    if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
      throw new ConflictException({
        code: 'NOT_CANCELLABLE',
        title: 'This order is already being made. Contact support if you need to change it.',
      });
    }
    // Paid orders need a refund, which accounts handles; the customer asks through a ticket.
    if (order.paymentStatus !== 'UNPAID') {
      throw new ConflictException({
        code: 'CANCEL_NEEDS_SUPPORT',
        title: 'This order has a payment against it. Raise a request and we will cancel and refund it.',
      });
    }

    await this.transition(order, 'CANCELLED', userId, dto.reason, {
      cancelledAt: new Date(),
      cancelReason: dto.reason,
    });
    return this.detail(userId, orderNo);
  }

  async respondToProof(userId: string, orderNo: string, proofId: string, dto: ProofDecisionDto) {
    const order = await this.load(userId, orderNo);
    const item = order.items.find((i) => i.proofs.some((p) => p.id === proofId));
    const proof = item?.proofs[0];
    if (!item || !proof || proof.id !== proofId) {
      throw new NotFoundException({
        code: 'PROOF_NOT_FOUND',
        title: 'This proof has been replaced by a newer one',
      });
    }
    if (proof.status !== 'PENDING') {
      throw new ConflictException({
        code: 'PROOF_ALREADY_ANSWERED',
        title: 'You have already answered this proof',
      });
    }
    if (dto.decision === 'CHANGES' && item.revisionsUsed >= FREE_REVISIONS) {
      throw new ConflictException({
        code: 'REVISIONS_USED',
        title: `All ${FREE_REVISIONS} rounds of changes have been used. Raise a request and our designers will call you.`,
      });
    }

    const approved = dto.decision === 'APPROVE';
    await this.prisma.$transaction(async (tx) => {
      await tx.designProof.update({
        where: { id: proof.id },
        data: {
          status: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
          customerComment: dto.comment || null,
          respondedAt: new Date(),
        },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: approved
          ? { proofStatus: 'APPROVED' }
          : { proofStatus: 'CHANGES_REQUESTED', revisionsUsed: { increment: 1 } },
      });

      const waiting = order.items.filter((i) => i.id !== item.id && i.proofStatus !== 'APPROVED');
      if (approved && waiting.length === 0 && order.status === 'PROOF_PENDING') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'PROOF_APPROVED' } });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'PROOF_APPROVED',
            actorId: userId,
            actorType: 'CUSTOMER',
            note: 'Design approved',
          },
        });
      }
    });
    return this.detail(userId, orderNo);
  }

  async review(userId: string, orderNo: string, dto: ReviewDto) {
    const order = await this.load(userId, orderNo);
    if (!REVIEWABLE.includes(order.status)) {
      throw new ConflictException({
        code: 'NOT_REVIEWABLE',
        title: 'You can review your sign once it arrives',
      });
    }
    if (order.review) {
      throw new ConflictException({
        code: 'ALREADY_REVIEWED',
        title: 'You have already reviewed this order',
      });
    }
    await this.prisma.review.create({
      data: { orderId: order.id, userId, rating: dto.rating, comment: dto.comment || null, photoKeys: [] },
    });
    return this.detail(userId, orderNo);
  }

  async openTicket(userId: string, orderNo: string, dto: TicketDto) {
    const order = await this.load(userId, orderNo);
    if (order.supportTickets.some((t) => t.type === dto.type && OPEN_TICKET.includes(t.status))) {
      throw new ConflictException({
        code: 'TICKET_ALREADY_OPEN',
        title: 'You already have an open request about this. We will be in touch soon.',
      });
    }
    await this.prisma.supportTicket.create({
      data: { orderId: order.id, type: dto.type, description: dto.description, photoKeys: [] },
    });
    return this.detail(userId, orderNo);
  }

  private async load(userId: string, orderNo: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { orderNo, customerId: userId },
      include: detailInclude,
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'Order not found' });
    return order;
  }

  private async transition(
    order: OrderDetail,
    toStatus: OrderDetail['status'],
    actorId: string,
    note: string,
    data: Prisma.OrderUpdateInput = {},
  ) {
    // Guarding on the current status makes a double click, or a staff update in between, a no-op.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { ...(data as Prisma.OrderUpdateManyMutationInput), status: toStatus },
      });
      if (!count) {
        throw new ConflictException({
          code: 'ORDER_CHANGED',
          title: 'This order was just updated. Refresh the page.',
        });
      }
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus, actorId, actorType: 'CUSTOMER', note },
      });
      if (toStatus === 'CANCELLED') await this.workflow.cancelWork(tx, order.id);
    });
  }

  private toView(order: OrderDetail) {
    const job = order.installationJobs[0];
    const snapshot = order.pricingSnapshot as {
      breakup?: { code: string; label: string; amountPaise: number }[];
    };

    return {
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMode: order.paymentMode,
      placedAt: order.createdAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      installationRequired: order.installationRequired,
      items: order.items.map((item) => ({
        id: item.id,
        description: item.description,
        widthIn: Number(item.widthIn),
        heightIn: Number(item.heightIn),
        qty: item.qty,
        unitPricePaise: paise(item.unitPricePaise),
        amountPaise: paise(item.lineTaxablePaise),
        previewUrl: this.storage.url(item.design?.previewKey),
        lettering: letteringOf(item.design?.config),
        proofStatus: item.proofStatus,
        revisionsLeft: Math.max(0, FREE_REVISIONS - item.revisionsUsed),
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
      breakup: snapshot.breakup ?? [],
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
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      history: order.statusHistory.map((h) => ({ status: h.toStatus, note: h.note, at: h.createdAt })),
      shipment:
        order.awbNo || order.courierName
          ? { courier: order.courierName, awbNo: order.awbNo, trackingUrl: order.trackingUrl }
          : null,
      installation: job
        ? {
            status: job.status,
            scheduledStart: job.scheduledStart,
            scheduledEnd: job.scheduledEnd,
            technician: job.technician?.name ?? null,
            completedAt: job.completedAt,
            // Read out to the technician once the sign is up; only shown while the visit is under way.
            completionCode: ['ON_THE_WAY', 'REACHED', 'WORK_STARTED'].includes(job.status)
              ? completionCode(job.id, this.config.get('JWT_SECRET', { infer: true }))
              : null,
          }
        : null,
      invoices: order.invoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        issuedAt: invoice.issuedAt,
        url: this.storage.url(invoice.pdfKey),
      })),
      review: order.review && {
        rating: order.review.rating,
        comment: order.review.comment,
        reply: order.review.reply,
        at: order.review.createdAt,
      },
      tickets: order.supportTickets.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        status: t.status,
        resolution: t.resolution,
        at: t.createdAt,
      })),
      canCancel: CUSTOMER_CANCELLABLE.includes(order.status) && order.paymentStatus === 'UNPAID',
      canReview: REVIEWABLE.includes(order.status) && !order.review,
    };
  }
}
