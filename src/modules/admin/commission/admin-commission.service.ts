import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { roundHalfUp, ruleScore } from '@neon-adda/shared';
import { Prisma } from '@prisma/client';
import { pageOf, skipTake } from '../../../common/http/pagination';
import { RequestMeta } from '../../../common/http/request-meta';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CommissionRuleDto, CommissionSettingsDto, LedgerQuery, MarkPaidDto } from './admin-commission.dto';

const paise = (value: bigint | null | undefined) => Number(value ?? 0);

@Injectable()
export class AdminCommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async rules() {
    const rules = await this.prisma.commissionRule.findMany({
      orderBy: [{ isActive: 'desc' }, { effectiveFrom: 'desc' }],
      include: {
        tier: { select: { name: true } },
        franchise: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    const now = new Date();
    return rules
      .map((rule) => ({
        id: rule.id,
        scope: rule.scope,
        tier: rule.tier?.name ?? null,
        franchise: rule.franchise?.name ?? null,
        category: rule.category?.name ?? null,
        source: rule.source,
        type: rule.type,
        value: Number(rule.value),
        maxPerOrderPaise: rule.maxPerOrderPaise === null ? null : paise(rule.maxPerOrderPaise),
        priority: rule.priority,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        live: rule.isActive && rule.effectiveFrom <= now && (!rule.effectiveTo || rule.effectiveTo > now),
        score: ruleScore({ ...rule, value: Number(rule.value), maxPerOrderPaise: null }),
      }))
      .sort((a, b) => Number(b.live) - Number(a.live) || b.score - a.score);
  }

  /**
   * Rules are never edited in place: commissions keep a snapshot of the rule that paid them,
   * and the history should read the same later. To change a rate, end the rule and add a new one.
   */
  async createRule(actorId: string, dto: CommissionRuleDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const rule = await tx.commissionRule.create({
        data: {
          ...dto,
          maxPerOrderPaise: dto.maxPerOrderPaise === null ? null : BigInt(dto.maxPerOrderPaise),
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'commission-rule.created',
          entity: 'commission-rule',
          entityId: rule.id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return this.rules();
  }

  async endRule(actorId: string, id: string, meta: RequestMeta) {
    const rule = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException({ code: 'RULE_NOT_FOUND', title: 'Rule not found' });
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionRule.update({ where: { id }, data: { isActive: false, effectiveTo: new Date() } });
      await this.audit.record(
        { actorId, action: 'commission-rule.ended', entity: 'commission-rule', entityId: id, ...meta },
        tx,
      );
    });
    return this.rules();
  }

  async ledger(query: LedgerQuery) {
    await this.promoteEligible();
    const where: Prisma.CommissionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.franchiseId ? { franchiseId: query.franchiseId } : {}),
    };
    const [rows, total, totals] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        include: {
          franchise: { select: { id: true, name: true } },
          order: { select: { orderNo: true, status: true, createdAt: true } },
          payout: { select: { id: true, status: true } },
        },
      }),
      this.prisma.commission.count({ where }),
      this.prisma.commission.groupBy({
        by: ['status'],
        where: query.franchiseId ? { franchiseId: query.franchiseId } : {},
        _sum: { amountPaise: true },
        _count: true,
      }),
    ]);

    return {
      ...pageOf(
        rows.map((row) => ({
          id: row.id,
          franchise: row.franchise,
          order: row.order,
          source: row.source,
          basePaise: paise(row.basePaise),
          amountPaise: paise(row.amountPaise),
          status: row.status,
          eligibleAt: row.eligibleAt,
          approvedAt: row.approvedAt,
          payout: row.payout,
        })),
        total,
        query,
      ),
      totals: Object.fromEntries(
        totals.map((t) => [t.status, { count: t._count, amountPaise: paise(t._sum.amountPaise) }]),
      ),
    };
  }

  async approve(actorId: string, ids: string[], meta: RequestMeta) {
    await this.promoteEligible();
    const { count } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.commission.updateMany({
        where: { id: { in: ids }, status: 'ELIGIBLE' },
        data: { status: 'APPROVED', approvedBy: actorId, approvedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId,
          action: 'commission.approved',
          entity: 'commission',
          entityId: ids[0]!,
          after: { ids },
          ...meta,
        },
        tx,
      );
      return result;
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'NOTHING_TO_APPROVE',
        title: 'Only eligible commission can be approved',
      });
    }
    return { approved: count };
  }

  async setHold(actorId: string, ids: string[], hold: boolean, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      await tx.commission.updateMany({
        where: {
          id: { in: ids },
          status: hold ? { in: ['PENDING', 'ELIGIBLE', 'APPROVED'] } : 'ON_HOLD',
          payoutId: null,
        },
        data: { status: hold ? 'ON_HOLD' : 'PENDING' },
      });
      await this.audit.record(
        {
          actorId,
          action: hold ? 'commission.held' : 'commission.released',
          entity: 'commission',
          entityId: ids[0]!,
          after: { ids },
          ...meta,
        },
        tx,
      );
    });
    await this.promoteEligible();
    return { updated: ids.length };
  }

  async payouts() {
    const [payouts, ready] = await Promise.all([
      this.prisma.payout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          franchise: { select: { name: true, bankName: true, ifsc: true } },
          _count: { select: { commissions: true } },
        },
      }),
      this.prisma.commission.groupBy({
        by: ['franchiseId'],
        where: { status: 'APPROVED', payoutId: null },
        _sum: { amountPaise: true },
        _count: true,
      }),
    ]);
    const franchises = await this.prisma.franchise.findMany({
      where: { id: { in: ready.map((r) => r.franchiseId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(franchises.map((f) => [f.id, f.name]));

    return {
      ready: ready.map((r) => ({
        franchiseId: r.franchiseId,
        franchise: nameOf.get(r.franchiseId) ?? '',
        commissions: r._count,
        amountPaise: paise(r._sum.amountPaise),
      })),
      payouts: payouts.map(({ _count, ...p }) => ({
        id: p.id,
        franchise: p.franchise.name,
        bank: p.franchise.bankName && `${p.franchise.bankName} · ${p.franchise.ifsc ?? ''}`,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        commissions: _count.commissions,
        grossPaise: paise(p.grossPaise),
        tdsPaise: paise(p.tdsPaise),
        netPaise: paise(p.netPaise),
        status: p.status,
        mode: p.mode,
        utr: p.utr,
        paidAt: p.paidAt,
      })),
    };
  }

  /** Bundles every approved, unpaid commission of a franchise into one draft payout. */
  async createPayout(actorId: string, franchiseId: string, meta: RequestMeta) {
    const commissions = await this.prisma.commission.findMany({
      where: { franchiseId, status: 'APPROVED', payoutId: null },
      include: { order: { select: { createdAt: true } } },
    });
    if (!commissions.length) {
      throw new UnprocessableEntityException({
        code: 'NOTHING_TO_PAY',
        title: 'This franchise has no approved commission to pay',
      });
    }
    const setting = await this.prisma.setting.findUnique({ where: { key: 'commission' } });
    const tdsPct = ((setting?.value ?? {}) as { tdsPct?: number }).tdsPct ?? 0;

    const gross = commissions.reduce((sum, c) => sum + paise(c.amountPaise), 0);
    const tds = roundHalfUp((gross * tdsPct) / 100);
    const dates = commissions.map((c) => c.order.createdAt.getTime());

    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          franchiseId,
          periodStart: new Date(Math.min(...dates)),
          periodEnd: new Date(Math.max(...dates)),
          grossPaise: BigInt(gross),
          tdsPaise: BigInt(tds),
          netPaise: BigInt(gross - tds),
          createdBy: actorId,
        },
      });
      const { count } = await tx.commission.updateMany({
        where: { id: { in: commissions.map((c) => c.id) }, status: 'APPROVED', payoutId: null },
        data: { payoutId: payout.id },
      });
      if (count !== commissions.length) {
        throw new ConflictException({
          code: 'LEDGER_CHANGED',
          title: 'The commission ledger changed. Try again.',
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'payout.created',
          entity: 'payout',
          entityId: payout.id,
          after: { gross, tds },
          ...meta,
        },
        tx,
      );
      return { id: payout.id };
    });
  }

  async markPaid(actorId: string, id: string, dto: MarkPaidDto, meta: RequestMeta) {
    const payout = await this.draftPayout(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id: payout.id },
          data: { status: 'PAID', utr: dto.utr, mode: dto.mode, paidAt: new Date() },
        });
        await tx.commission.updateMany({ where: { payoutId: payout.id }, data: { status: 'PAID' } });
        await this.audit.record(
          { actorId, action: 'payout.paid', entity: 'payout', entityId: id, after: dto, ...meta },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'UTR_USED',
          title: 'This bank reference is already recorded on another payout',
        });
      }
      throw error;
    }
    return this.payouts();
  }

  async cancelPayout(actorId: string, id: string, meta: RequestMeta) {
    const payout = await this.draftPayout(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.commission.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
      await tx.payout.update({ where: { id: payout.id }, data: { status: 'CANCELLED' } });
      await this.audit.record(
        { actorId, action: 'payout.cancelled', entity: 'payout', entityId: id, ...meta },
        tx,
      );
    });
    return this.payouts();
  }

  async settings() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'commission' } });
    return setting?.value ?? { eligibilityDays: 7, includeInstallation: false, tdsPct: 0 };
  }

  async saveSettings(actorId: string, dto: CommissionSettingsDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: 'commission' },
        update: { value: dto, updatedBy: actorId },
        create: { key: 'commission', value: dto, updatedBy: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: 'commission.settings-changed',
          entity: 'setting',
          entityId: 'commission',
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return this.settings();
  }

  /** Commission becomes payable once its return window has passed. */
  private promoteEligible() {
    return this.prisma.commission.updateMany({
      where: { status: 'PENDING', eligibleAt: { lte: new Date() } },
      data: { status: 'ELIGIBLE' },
    });
  }

  private async draftPayout(id: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', title: 'Payout not found' });
    if (payout.status !== 'DRAFT')
      throw new ConflictException({ code: 'PAYOUT_CLOSED', title: 'This payout is already closed' });
    return payout;
  }
}
