import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { formatINR } from '@neon-adda/shared';
import { Payment, Prisma } from '@prisma/client';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderWorkflowService } from '../order-workflow/order-workflow.service';
import { PaymentFailedDto, RefundDto, VerifyPaymentDto } from './payments.dto';
import { GatewayPayment, RazorpayGateway } from './razorpay.gateway';

/** How often unpaid online orders are checked, and how long past their deadline they are given. */
const SWEEP_EVERY_MS = 5 * 60_000;
const EXPIRY_GRACE_MS = 10 * 60_000;

type Tx = Prisma.TransactionClient;

export type SettleOutcome = 'paid' | 'already-paid' | 'failed' | 'pending';

/**
 * Online payment through Razorpay. An order is only ever marked paid after the payment has been
 * checked with Razorpay itself, for this gateway order and for exactly the amount due: a browser
 * saying "it worked" is not enough, and neither is a signature alone.
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayGateway,
    private readonly workflow: OrderWorkflowService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.sweeper = setInterval(() => {
      this.sweepUnpaid().catch((error) =>
        this.logger.error('Unpaid order sweep failed', error instanceof Error ? error.stack : error),
      );
    }, SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  get onlineAvailable(): boolean {
    return this.gateway.configured;
  }

  /** Opens (or reopens) payment for an order awaiting online payment. */
  async start(userId: string, orderNo: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNo, customerId: userId },
      include: {
        customer: { select: { name: true, email: true, phone: true } },
        payments: { where: { method: 'RAZORPAY', status: 'CREATED' }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'Order not found' });
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException({
        code: order.paymentStatus === 'PAID' ? 'ALREADY_PAID' : 'NOT_PAYABLE',
        title:
          order.paymentStatus === 'PAID'
            ? 'This order is already paid'
            : 'This order is not waiting for payment',
      });
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new ConflictException({
        code: 'ORDER_EXPIRED',
        title: 'The time to pay for this order has passed. Place the order again from your cart.',
      });
    }
    if (!this.gateway.configured) {
      throw new UnprocessableEntityException({
        code: 'ONLINE_PAYMENT_UNAVAILABLE',
        title: 'Online payment is not available right now. Contact us to pay another way.',
      });
    }

    const amount = order.amountDuePaise;
    // Reopening the payment window reuses the gateway order, so a customer cannot be charged twice for it.
    let payment = order.payments.find((p) => p.amountPaise === amount);
    if (!payment) {
      const remote = await this.gateway.createOrder(Number(amount), orderNo, { orderNo });
      if (remote.amount !== Number(amount) || remote.currency !== 'INR') {
        throw new ConflictException({
          code: 'GATEWAY_MISMATCH',
          title: 'Payment could not be set up. Try again.',
        });
      }
      payment = await this.prisma.payment.create({
        data: {
          orderId: order.id,
          purpose: 'FULL',
          method: 'RAZORPAY',
          amountPaise: amount,
          status: 'CREATED',
          gatewayOrderId: remote.id,
        },
      });
    }
    return {
      orderNo,
      keyId: this.gateway.publicKey,
      gatewayOrderId: payment.gatewayOrderId!,
      amountPaise: Number(amount),
      currency: 'INR',
      testMode: this.gateway.testMode,
      expiresAt: order.expiresAt,
      prefill: {
        name: order.customer.name ?? undefined,
        email: order.customer.email ?? undefined,
        contact: order.customer.phone ?? undefined,
      },
    };
  }

  /** The browser's report that checkout finished. Checked by signature, then with Razorpay. */
  async verify(userId: string, orderNo: string, dto: VerifyPaymentDto) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        gatewayOrderId: dto.gatewayOrderId,
        method: 'RAZORPAY',
        order: { orderNo, customerId: userId },
      },
    });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', title: 'Payment not found' });
    if (!this.gateway.checkoutSignatureValid(dto.gatewayOrderId, dto.paymentId, dto.signature)) {
      this.logger.warn(`Payment for ${orderNo} came back with a signature that does not match`);
      throw new BadRequestException({
        code: 'PAYMENT_NOT_VERIFIED',
        title:
          'We could not confirm this payment. If money left your account, it will be refunded or added to this order once we confirm it.',
      });
    }
    const remote = await this.gateway.fetchPayment(dto.paymentId);
    const outcome = await this.settle(payment, remote, 'checkout');
    return { outcome, orderNo };
  }

  /**
   * The browser's report that a payment attempt failed. It is only a note on the attempt: if
   * Razorpay later reports the same order as paid, that wins.
   */
  async recordFailure(userId: string, orderNo: string, dto: PaymentFailedDto) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        gatewayOrderId: dto.gatewayOrderId,
        method: 'RAZORPAY',
        order: { orderNo, customerId: userId },
      },
    });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', title: 'Payment not found' });
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CREATED' },
      data: {
        raw: {
          lastFailure: { code: dto.code ?? null, reason: dto.reason ?? null, at: new Date().toISOString() },
        },
      },
    });
    return { outcome: 'failed' as const, orderNo };
  }

  /** Razorpay's webhook, already checked against the webhook secret by the controller. */
  async handleWebhook(event: { event?: string; payload?: Record<string, { entity?: unknown }> }) {
    const name = event.event ?? '';
    const entity = event.payload?.payment?.entity as GatewayPayment | undefined;
    if (
      (name === 'payment.captured' || name === 'order.paid' || name === 'payment.authorized') &&
      entity?.order_id
    ) {
      const payment = await this.prisma.payment.findFirst({
        where: { gatewayOrderId: entity.order_id, method: 'RAZORPAY' },
        orderBy: { createdAt: 'desc' },
      });
      // A payment that does not match is logged by settle and left for the team; Razorpay is told the
      // event arrived, since sending it again would not change the answer.
      if (payment)
        await this.settle(payment, entity, 'webhook').catch((error: unknown) => this.logger.error(error));
      return;
    }
    if (name === 'payment.failed' && entity?.order_id) {
      await this.prisma.payment.updateMany({
        where: { gatewayOrderId: entity.order_id, method: 'RAZORPAY', status: 'CREATED' },
        data: {
          raw: { lastFailure: { code: entity.error_code ?? null, reason: entity.error_description ?? null } },
        },
      });
      return;
    }
    const refund = event.payload?.refund?.entity as { id?: string; status?: string } | undefined;
    if ((name === 'refund.processed' || name === 'refund.failed') && refund?.id) {
      const row = await this.prisma.refund.findUnique({ where: { gatewayRefundId: refund.id } });
      if (!row || row.status !== 'PENDING') return;
      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: row.id },
          data: { status: name === 'refund.processed' ? 'PROCESSED' : 'FAILED' },
        });
        await this.refreshRefundState(tx, row.paymentId);
      });
    }
  }

  /**
   * Applies a payment as Razorpay reports it. Only a captured payment for this gateway order, in
   * rupees, for exactly the amount asked, marks the order paid. Safe to run twice for one payment.
   */
  async settle(
    payment: Payment,
    remote: GatewayPayment,
    source: 'checkout' | 'webhook' | 'sweep',
  ): Promise<SettleOutcome> {
    if (
      remote.order_id !== payment.gatewayOrderId ||
      remote.currency !== 'INR' ||
      remote.amount !== Number(payment.amountPaise)
    ) {
      this.logger.error(
        `Payment ${remote.id} does not match the expected order or amount (${source}); not applied`,
      );
      throw new ConflictException({
        code: 'PAYMENT_MISMATCH',
        title: 'This payment does not match the order. Contact us and we will sort it out.',
      });
    }
    let current = remote;
    if (current.status === 'authorized') current = await this.gateway.capture(current.id, current.amount);
    if (current.status === 'failed') return 'failed';
    if (current.status !== 'captured') return 'pending';

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const taken = await tx.payment.updateMany({
          where: { id: payment.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] } },
          data: {
            status: 'CAPTURED',
            gatewayPaymentId: current.id,
            gatewayMethod: current.method?.slice(0, 20) ?? null,
            capturedAt: new Date(),
            raw: { source, status: current.status, method: current.method ?? null },
          },
        });
        if (!taken.count) return 'already-paid' as const;

        const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        const paid = fresh.amountPaidPaise + payment.amountPaise;
        const due = fresh.totalPaise - paid;
        await tx.order.update({
          where: { id: order.id },
          data: {
            amountPaidPaise: paid,
            amountDuePaise: due > 0n ? due : 0n,
            paymentStatus: due <= 0n ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
        // A payment that lands after the order lapsed still counts: the customer has paid.
        if (fresh.status === 'PENDING_PAYMENT' || fresh.status === 'EXPIRED') {
          await this.workflow.confirm(tx, await this.workflow.load(tx, order.id), order.customerId, {
            note: 'Paid online',
            actorType: 'CUSTOMER',
          });
        }
        await this.audit.record(
          {
            actorId: order.customerId,
            action: 'order.paid-online',
            entity: 'order',
            entityId: order.id,
            after: {
              paymentId: payment.id,
              gatewayPaymentId: current.id,
              amountPaise: Number(payment.amountPaise),
              source,
            },
          },
          tx,
        );
        return 'paid' as const;
      });
      if (outcome === 'paid') {
        await this.notifications.notify(
          order.customerId,
          order.status === 'CANCELLED'
            ? {
                kind: 'order.updated',
                title: `Payment received for cancelled order ${order.orderNo}`,
                body: `We received ${formatINR(Number(payment.amountPaise), { paise: true })} after the order was cancelled. We will refund it.`,
                link: `/orders/${order.orderNo}`,
              }
            : {
                kind: 'order.placed',
                title: `Order ${order.orderNo} confirmed`,
                body: `We received your payment of ${formatINR(Number(payment.amountPaise), { paise: true })}.`,
                link: `/orders/${order.orderNo}`,
              },
          ['customer'],
        );
      }
      return outcome;
    } catch (error) {
      // The same Razorpay payment already settled another row: nothing more to do.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return 'already-paid';
      throw error;
    }
  }

  /**
   * Finds online payments whose result never reached us (closed tab, no webhook), then lets orders
   * that were never paid lapse so their coupon and slot are freed.
   */
  async sweepUnpaid(now = new Date()) {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', expiresAt: { lt: new Date(now.getTime() - EXPIRY_GRACE_MS) } },
      include: { payments: { where: { method: 'RAZORPAY', status: { in: ['CREATED', 'FAILED'] } } } },
      take: 100,
    });
    for (const order of due) {
      let paid = false;
      if (this.gateway.configured) {
        for (const payment of order.payments) {
          const attempts = await this.gateway.orderPayments(payment.gatewayOrderId!).catch(() => null);
          if (!attempts) {
            paid = true; // Unknown: try again on the next sweep rather than expire a possibly paid order.
            continue;
          }
          const captured = attempts.items.find((a) => a.status === 'captured' || a.status === 'authorized');
          if (!captured) continue;
          const outcome = await this.settle(payment, captured, 'sweep').catch(() => 'pending' as const);
          // Anything but a clear "not paid" keeps the order open for a person to look at.
          if (outcome !== 'failed') paid = true;
        }
      }
      if (paid) continue;
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT' },
          data: { status: 'EXPIRED' },
        });
        if (!count) return;
        await this.workflow.history(
          tx,
          order.id,
          'PENDING_PAYMENT',
          'EXPIRED',
          order.customerId,
          'Not paid in time',
          'CUSTOMER',
        );
        await this.workflow.cancelWork(tx, order.id);
      });
    }
    return due.length;
  }

  /**
   * Returns money on a captured payment: through Razorpay for online payments, or as a record of a
   * refund the team paid by hand for cash and bank payments.
   */
  async refund(actorId: string, orderNo: string, dto: RefundDto, meta: RequestMeta) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: dto.paymentId, order: { orderNo } },
      include: { order: { select: { id: true, orderNo: true, customerId: true } } },
    });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', title: 'Payment not found' });
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw new ConflictException({
        code: 'NOT_REFUNDABLE',
        title: 'Only a received payment can be refunded',
      });
    }
    const online = payment.method === 'RAZORPAY' || payment.method === 'PAYMENT_LINK';
    if (online && !payment.gatewayPaymentId) {
      throw new ConflictException({ code: 'NOT_REFUNDABLE', title: 'This payment has no gateway reference' });
    }

    // Reserve the amount first, with the payment row locked, so two refunds cannot both pass the check.
    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const used = await tx.refund.aggregate({
        where: { paymentId: payment.id, status: { in: ['PENDING', 'PROCESSED'] } },
        _sum: { amountPaise: true },
      });
      const left = payment.amountPaise - (used._sum.amountPaise ?? 0n);
      if (BigInt(dto.amountPaise) > left) {
        throw new UnprocessableEntityException({
          code: 'REFUND_TOO_LARGE',
          title: `Only ${formatINR(Number(left), { paise: true })} of this payment can still be refunded`,
        });
      }
      const row = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountPaise: BigInt(dto.amountPaise),
          reason: dto.reference ? `${dto.reason} (ref ${dto.reference})` : dto.reason,
          status: online ? 'PENDING' : 'PROCESSED',
          initiatedBy: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'order.refund-started',
          entity: 'order',
          entityId: payment.order.id,
          after: { refundId: row.id, ...dto },
          ...meta,
        },
        tx,
      );
      if (!online) await this.refreshRefundState(tx, payment.id);
      return row;
    });

    if (online) {
      try {
        const remote = await this.gateway.refund(payment.gatewayPaymentId!, dto.amountPaise, { orderNo });
        await this.prisma.$transaction(async (tx) => {
          await tx.refund.update({
            where: { id: refund.id },
            data: {
              gatewayRefundId: remote.id,
              status:
                remote.status === 'processed'
                  ? 'PROCESSED'
                  : remote.status === 'failed'
                    ? 'FAILED'
                    : 'PENDING',
            },
          });
          await this.refreshRefundState(tx, payment.id);
        });
      } catch (error) {
        await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
        throw error;
      }
    }

    await this.notifications.notify(
      payment.order.customerId,
      {
        kind: 'order.updated',
        title: `Refund for ${orderNo}`,
        body: `We have refunded ${formatINR(dto.amountPaise, { paise: true })}. ${online ? 'It usually reaches your account in 5–7 working days.' : ''}`.trim(),
        link: `/orders/${orderNo}`,
      },
      ['customer'],
    );
    return { refundId: refund.id };
  }

  /** Sets the payment's and the order's refund state from the refunds that have gone through. */
  private async refreshRefundState(tx: Tx, paymentId: string) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const refunded = await tx.refund.aggregate({
      where: { paymentId, status: 'PROCESSED' },
      _sum: { amountPaise: true },
    });
    const sum = refunded._sum.amountPaise ?? 0n;
    if (sum > 0n) {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: sum >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    const allRefunds = await tx.refund.aggregate({
      where: { payment: { orderId: order.id }, status: 'PROCESSED' },
      _sum: { amountPaise: true },
    });
    const total = allRefunds._sum.amountPaise ?? 0n;
    if (total > 0n) {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: total >= order.amountPaidPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
    }
  }
}
