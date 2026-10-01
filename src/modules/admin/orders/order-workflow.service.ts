import { Injectable } from '@nestjs/common';
import { CommissionRule, resolveCommission, roundHalfUp } from '@neon-adda/shared';
import { OrderStatus, Prisma } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';

type Tx = Prisma.TransactionClient;

interface CommissionSettings {
  eligibilityDays: number;
  includeInstallation: boolean;
}

export interface CompanyDetails {
  legalName: string;
  tradeName?: string;
  gstin?: string | null;
  address?: string;
  stateCode: string;
  email?: string;
  phone?: string;
}

const orderForWorkflow = {
  items: { orderBy: { id: 'asc' } },
  franchise: { select: { id: true, tierId: true, status: true } },
} satisfies Prisma.OrderInclude;

type WorkflowOrder = Prisma.OrderGetPayload<{ include: typeof orderForWorkflow }>;

/**
 * What happens to an order beyond its own row when it moves on: the installation job, the
 * franchise's commission and the tax invoice. Everything runs inside the caller's transaction.
 */
@Injectable()
export class OrderWorkflowService {
  constructor(private readonly notifications: NotificationsService) {}

  load(tx: Tx, orderId: string) {
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderForWorkflow });
  }

  /** Payment received: the order is confirmed and work can be scheduled. */
  async confirm(tx: Tx, order: WorkflowOrder, actorId: string) {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    await this.history(tx, order.id, order.status, 'CONFIRMED', actorId, 'Payment received');

    if (order.installationRequired) {
      await tx.installationJob.create({ data: { orderId: order.id, franchiseId: order.franchiseId } });
    }
    await this.accrueCommission(tx, order);
  }

  async history(
    tx: Tx,
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    actorId: string,
    note?: string,
  ) {
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: from, toStatus: to, actorId, actorType: 'STAFF', note },
    });
  }

  /**
   * Commission is accrued once, when the customer first pays. It stays PENDING until the order is
   * complete and the return window has passed.
   */
  private async accrueCommission(tx: Tx, order: WorkflowOrder) {
    if (!order.franchise || order.attributionSource === 'NONE') return;

    const now = new Date();
    const [rules, setting] = await Promise.all([
      tx.commissionRule.findMany({
        where: {
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
      }),
      tx.setting.findUnique({ where: { key: 'commission' } }),
    ]);
    const settings = (setting?.value ?? { includeInstallation: false }) as unknown as CommissionSettings;

    // The order discount is shared across lines by value, so commission is paid on what was charged.
    const gross = order.items.reduce(
      (sum, item) => sum + Number(item.lineTaxablePaise) + Number(item.lineInstallationPaise),
      0,
    );
    const discount = Number(order.discountPaise);
    const result = resolveCommission(
      {
        franchiseId: order.franchise.id,
        tierId: order.franchise.tierId,
        source: order.attributionSource === 'SELF_SOURCED' ? 'SELF_SOURCED' : 'ASSIGNED',
        paidAt: now,
        includeInstallation: settings.includeInstallation,
        lines: order.items.map((item) => {
          const value = Number(item.lineTaxablePaise) + Number(item.lineInstallationPaise);
          const share = gross ? roundHalfUp((discount * value) / gross) : 0;
          return {
            categoryId: item.categoryId ?? '',
            taxablePaise: value - share,
            installationPaise: Number(item.lineInstallationPaise),
          };
        }),
      },
      rules.map((rule): CommissionRule => ({
        id: rule.id,
        scope: rule.scope,
        tierId: rule.tierId,
        franchiseId: rule.franchiseId,
        categoryId: rule.categoryId,
        source: rule.source,
        type: rule.type,
        value: Number(rule.value),
        maxPerOrderPaise: rule.maxPerOrderPaise === null ? null : Number(rule.maxPerOrderPaise),
        priority: rule.priority,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        isActive: rule.isActive,
      })),
    );
    if (!result || result.amountPaise <= 0) return;

    await tx.commission.create({
      data: {
        orderId: order.id,
        franchiseId: order.franchise.id,
        source: order.attributionSource,
        basePaise: BigInt(result.basePaise),
        amountPaise: BigInt(result.amountPaise),
        ruleSnapshot: {
          lines: result.lines,
          appliedRuleIds: result.appliedRuleIds,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Completion starts the return window, after which the commission can be approved. */
  async markCommissionEligible(tx: Tx, orderId: string) {
    const setting = await tx.setting.findUnique({ where: { key: 'commission' } });
    const days = ((setting?.value ?? {}) as Partial<CommissionSettings>).eligibilityDays ?? 7;
    await tx.commission.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { eligibleAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000) },
    });
  }

  async reverseCommission(tx: Tx, orderId: string) {
    await tx.commission.updateMany({
      where: { orderId, status: { in: ['PENDING', 'ELIGIBLE', 'ON_HOLD'] } },
      data: { status: 'REVERSED' },
    });
  }

  /**
   * Issues the GST tax invoice when the goods leave. Numbers run per financial year without gaps,
   * so the sequence row is locked for the length of the transaction.
   */
  async issueInvoice(tx: Tx, orderId: string): Promise<string> {
    const existing = await tx.invoice.findFirst({ where: { orderId, type: 'TAX_INVOICE' } });
    if (existing) return existing.invoiceNo;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    const [company, pricing] = await Promise.all([
      tx.setting.findUnique({ where: { key: 'company' } }),
      tx.setting.findUnique({ where: { key: 'pricing' } }),
    ]);
    const seller = (company?.value ?? {
      legalName: 'Neon Adda',
      stateCode: '27',
    }) as unknown as CompanyDetails;
    const hsn = ((pricing?.value ?? {}) as { hsnCode?: string }).hsnCode ?? '9405';

    const financialYear = financialYearOf(new Date());
    await tx.invoiceSequence.upsert({
      where: { financialYear_type: { financialYear, type: 'TAX_INVOICE' } },
      update: {},
      create: { financialYear, type: 'TAX_INVOICE' },
    });
    const [sequence] = await tx.$queryRaw<[{ lastNo: number }]>`
      UPDATE invoice_sequences SET "lastNo" = "lastNo" + 1
      WHERE "financialYear" = ${financialYear} AND type = 'TAX_INVOICE'
      RETURNING "lastNo"`;
    const invoiceNo = `NA/${financialYear}/${String(sequence.lastNo).padStart(5, '0')}`;

    const paise = (value: bigint) => Number(value);
    await tx.invoice.create({
      data: {
        invoiceNo,
        orderId,
        financialYear,
        hsn,
        seller: seller as unknown as Prisma.InputJsonValue,
        buyer: order.billingAddress as Prisma.InputJsonValue,
        lines: [
          ...order.items.map((item) => ({
            description: item.description,
            hsn,
            qty: item.qty,
            unitPricePaise: paise(item.unitPricePaise),
            amountPaise: paise(item.lineTaxablePaise),
          })),
          ...(order.installationPaise
            ? [
                {
                  description: 'Installation',
                  hsn: '998729',
                  qty: 1,
                  unitPricePaise: paise(order.installationPaise),
                  amountPaise: paise(order.installationPaise),
                },
              ]
            : []),
          ...(order.deliveryPaise
            ? [
                {
                  description: 'Delivery',
                  hsn: '996812',
                  qty: 1,
                  unitPricePaise: paise(order.deliveryPaise),
                  amountPaise: paise(order.deliveryPaise),
                },
              ]
            : []),
        ],
        totals: {
          discountPaise: paise(order.discountPaise),
          taxablePaise: paise(order.taxablePaise),
          cgstPaise: paise(order.cgstPaise),
          sgstPaise: paise(order.sgstPaise),
          igstPaise: paise(order.igstPaise),
          roundOffPaise: paise(order.roundOffPaise),
          totalPaise: paise(order.totalPaise),
          placeOfSupply: order.placeOfSupplyState,
          customerGstin: order.customerGstin,
          orderNo: order.orderNo,
        },
      },
    });
    return invoiceNo;
  }

  /** Customer notices are sent after the transaction commits, so a failed change never notifies. */
  notifyCustomer(customerId: string, orderNo: string, title: string, body: string) {
    return this.notifications.notify(
      customerId,
      { kind: 'order.updated', title, body, link: `/orders/${orderNo}` },
      ['customer'],
    );
  }
}

/** April to March: 2026-09-30 → "2026-27". */
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
