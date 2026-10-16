import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClaimStatus, Prisma } from '@prisma/client';
import { pageOf, skipTake } from '../../common/http/pagination';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextClaimNo } from '../orders/document-numbers';
import {
  ApproveClaimDto,
  ClaimListQuery,
  CreateClaimDto,
  MAX_EVIDENCE_FILES,
  ReviewNoteDto,
  SubmitClaimDto,
} from './claims.dto';
import { promoteEligibleCommission } from './commission-ledger';

const paise = (value: bigint | null | undefined) => Number(value ?? 0n);

/** The claim states in which the partner may still change the evidence. */
const EDITABLE: ClaimStatus[] = ['DRAFT', 'DISPUTED'];
/** The claim states waiting for the accounts team. */
const IN_REVIEW: ClaimStatus[] = ['SUBMITTED', 'DISPUTED'];

const evidenceSummary = { select: { id: true, fileName: true, mime: true, bytes: true, createdAt: true } };

export interface EvidenceFile {
  body: Buffer;
  mime: string;
  fileName: string;
}

/**
 * Commission claims. A franchise gathers its eligible commission into a claim, adds bank statements
 * or receipts and submits it; the accounts team checks the evidence against the bank and approves,
 * rejects or disputes it. Approved commission then goes out in a payout as before.
 *
 * Each commission can be in one open claim only: creating a claim moves its commissions out of
 * ELIGIBLE in the same statement that checks they are still ELIGIBLE, so two claims (or a claim and
 * a direct approval) can never take the same commission.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Franchise side ----

  async partnerClaims(franchiseId: string) {
    await promoteEligibleCommission(this.prisma);
    const [claims, claimable] = await Promise.all([
      this.prisma.commissionClaim.findMany({
        where: { franchiseId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { _count: { select: { commissions: true, evidence: true } } },
      }),
      this.prisma.commission.findMany({
        where: { franchiseId, status: 'ELIGIBLE', claimId: null, payoutId: null },
        orderBy: { createdAt: 'asc' },
        include: { order: { select: { orderNo: true, status: true } } },
      }),
    ]);
    return {
      claims: claims.map((claim) => this.toSummary(claim)),
      claimable: {
        amountPaise: claimable.reduce((sum, c) => sum + paise(c.amountPaise), 0),
        commissions: claimable.map((c) => ({
          id: c.id,
          orderNo: c.order.orderNo,
          orderStatus: c.order.status,
          amountPaise: paise(c.amountPaise),
          eligibleAt: c.eligibleAt,
        })),
      },
    };
  }

  async partnerClaim(franchiseId: string, claimId: string) {
    return this.detail(await this.claimOf(claimId, franchiseId), false);
  }

  async createDraft(actorId: string, franchiseId: string, dto: CreateClaimDto, meta: RequestMeta) {
    await promoteEligibleCommission(this.prisma);
    const where: Prisma.CommissionWhereInput = {
      franchiseId,
      status: 'ELIGIBLE',
      claimId: null,
      payoutId: null,
      ...(dto.commissionIds ? { id: { in: dto.commissionIds } } : {}),
    };
    const id = await this.prisma.$transaction(async (tx) => {
      const commissions = await tx.commission.findMany({ where, select: { id: true, amountPaise: true } });
      if (!commissions.length || (dto.commissionIds && commissions.length !== dto.commissionIds.length)) {
        throw new UnprocessableEntityException({
          code: 'NOTHING_TO_CLAIM',
          title: dto.commissionIds
            ? 'Some of these commissions are not eligible or are already claimed'
            : 'There is no eligible commission to claim yet',
        });
      }
      const amount = commissions.reduce((sum, c) => sum + c.amountPaise, 0n);
      const claim = await tx.commissionClaim.create({
        data: { claimNo: await nextClaimNo(tx), franchiseId, amountPaise: amount, note: dto.note ?? null },
      });
      // The status condition is checked again by the update itself, so a commission taken by a
      // concurrent claim or approval since the read above makes the counts differ and nothing is kept.
      const { count } = await tx.commission.updateMany({
        where: {
          id: { in: commissions.map((c) => c.id) },
          status: 'ELIGIBLE',
          claimId: null,
          payoutId: null,
        },
        data: { status: 'CLAIMED', claimId: claim.id },
      });
      if (count !== commissions.length) throw this.ledgerChanged();
      await this.audit.record(
        {
          actorId,
          action: 'claim.drafted',
          entity: 'commission-claim',
          entityId: claim.id,
          after: { claimNo: claim.claimNo, amountPaise: Number(amount), commissions: count },
          ...meta,
        },
        tx,
      );
      return claim.id;
    });
    return this.partnerClaim(franchiseId, id);
  }

  async addEvidence(
    actorId: string,
    franchiseId: string,
    claimId: string,
    file: EvidenceFile,
    meta: RequestMeta,
  ) {
    const claim = await this.claimOf(claimId, franchiseId);
    this.assertEditable(claim.status);
    await this.prisma.$transaction(async (tx) => {
      // Counted inside the transaction with the claim row locked, so parallel uploads cannot pass the limit.
      await tx.$queryRaw`SELECT 1 FROM commission_claims WHERE id = ${claim.id}::uuid FOR UPDATE`;
      const files = await tx.claimEvidence.count({ where: { claimId } });
      if (files >= MAX_EVIDENCE_FILES) {
        throw new UnprocessableEntityException({
          code: 'TOO_MANY_FILES',
          title: `A claim can have up to ${MAX_EVIDENCE_FILES} files. Remove one first.`,
        });
      }
      const evidence = await tx.claimEvidence.create({
        data: {
          claimId,
          fileName: file.fileName,
          mime: file.mime,
          bytes: file.body.length,
          data: new Uint8Array(file.body),
          uploadedBy: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'claim.evidence-added',
          entity: 'commission-claim',
          entityId: claimId,
          after: { evidenceId: evidence.id, fileName: file.fileName, bytes: file.body.length },
          ...meta,
        },
        tx,
      );
    });
    return this.partnerClaim(franchiseId, claimId);
  }

  async removeEvidence(
    actorId: string,
    franchiseId: string,
    claimId: string,
    evidenceId: string,
    meta: RequestMeta,
  ) {
    const claim = await this.claimOf(claimId, franchiseId);
    this.assertEditable(claim.status);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.claimEvidence.deleteMany({ where: { id: evidenceId, claimId } });
      if (!count) throw new NotFoundException({ code: 'EVIDENCE_NOT_FOUND', title: 'File not found' });
      await this.audit.record(
        {
          actorId,
          action: 'claim.evidence-removed',
          entity: 'commission-claim',
          entityId: claimId,
          after: { evidenceId },
          ...meta,
        },
        tx,
      );
    });
    return this.partnerClaim(franchiseId, claimId);
  }

  /** Sends a draft for review, or sends a disputed claim back once more evidence is added. */
  async submit(
    actorId: string,
    franchiseId: string,
    claimId: string,
    dto: SubmitClaimDto,
    meta: RequestMeta,
  ) {
    const claim = await this.claimOf(claimId, franchiseId);
    this.assertEditable(claim.status);
    if (!claim.evidence.length) {
      throw new UnprocessableEntityException({
        code: 'EVIDENCE_REQUIRED',
        title: 'Add a bank statement or receipt before you submit',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.commissionClaim.updateMany({
        where: { id: claimId, status: claim.status },
        data: {
          status: 'SUBMITTED',
          submittedBy: actorId,
          submittedAt: new Date(),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      if (!count) throw this.claimChanged();
      await tx.commission.updateMany({
        where: { claimId, status: { in: ['CLAIMED', 'DISPUTED'] } },
        data: { status: 'CLAIMED' },
      });
      await this.audit.record(
        {
          actorId,
          action: claim.status === 'DISPUTED' ? 'claim.resubmitted' : 'claim.submitted',
          entity: 'commission-claim',
          entityId: claimId,
          before: { status: claim.status },
          after: { status: 'SUBMITTED', note: dto.note },
          ...meta,
        },
        tx,
      );
    });
    return this.partnerClaim(franchiseId, claimId);
  }

  /** Throws away a draft and makes its commissions claimable again. */
  async discard(actorId: string, franchiseId: string, claimId: string, meta: RequestMeta) {
    const claim = await this.claimOf(claimId, franchiseId);
    if (claim.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CLAIM_LOCKED', title: 'Only a draft claim can be deleted' });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.releaseCommissions(tx, claimId);
      // The audit log keeps the record of it; the draft itself and its files go.
      const { count } = await tx.commissionClaim.deleteMany({ where: { id: claimId, status: 'DRAFT' } });
      if (!count) throw this.claimChanged();
      await this.audit.record(
        {
          actorId,
          action: 'claim.withdrawn',
          entity: 'commission-claim',
          entityId: claimId,
          before: { status: 'DRAFT', claimNo: claim.claimNo, amountPaise: Number(claim.amountPaise) },
          ...meta,
        },
        tx,
      );
    });
    return { ok: true };
  }

  // ---- Accounts team side ----

  async adminClaims(query: ClaimListQuery) {
    const where: Prisma.CommissionClaimWhereInput = {
      // Drafts are the partner's work in progress, not something to review.
      status: query.status ?? { not: 'DRAFT' },
      ...(query.franchiseId ? { franchiseId: query.franchiseId } : {}),
    };
    const [claims, total, counts] = await Promise.all([
      this.prisma.commissionClaim.findMany({
        where,
        orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        ...skipTake(query),
        include: {
          franchise: { select: { id: true, name: true, code: true } },
          _count: { select: { commissions: true, evidence: true } },
        },
      }),
      this.prisma.commissionClaim.count({ where }),
      this.prisma.commissionClaim.groupBy({ by: ['status'], _count: true, _sum: { amountPaise: true } }),
    ]);
    return {
      ...pageOf(
        claims.map((claim) => ({ ...this.toSummary(claim), franchise: claim.franchise })),
        total,
        query,
      ),
      totals: Object.fromEntries(
        counts.map((c) => [c.status, { count: c._count, amountPaise: paise(c._sum.amountPaise) }]),
      ),
    };
  }

  async adminClaim(claimId: string) {
    return this.detail(await this.claimOf(claimId), true);
  }

  async approve(actorId: string, claimId: string, dto: ApproveClaimDto, meta: RequestMeta) {
    const claim = await this.claimOf(claimId);
    this.assertInReview(claim.status);
    const reused = await this.prisma.commissionClaim.findFirst({
      where: {
        reconciledReference: dto.reconciledReference,
        id: { not: claimId },
        status: { in: ['APPROVED', 'PAID'] },
      },
      select: { claimNo: true },
    });
    if (reused) {
      throw new ConflictException({
        code: 'REFERENCE_USED',
        title: `This reference was already matched to claim ${reused.claimNo}`,
        field: 'reconciledReference',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.commissionClaim.updateMany({
        where: { id: claimId, status: claim.status },
        data: {
          status: 'APPROVED',
          reviewedBy: actorId,
          reviewedAt: now,
          reviewNote: dto.note ?? null,
          reconciledReference: dto.reconciledReference,
        },
      });
      if (!count) throw this.claimChanged();
      await tx.commission.updateMany({
        where: { claimId, status: { in: ['CLAIMED', 'DISPUTED'] } },
        data: { status: 'APPROVED', approvedBy: actorId, approvedAt: now },
      });
      await this.audit.record(
        {
          actorId,
          action: 'claim.approved',
          entity: 'commission-claim',
          entityId: claimId,
          before: { status: claim.status },
          after: { status: 'APPROVED', ...dto },
          ...meta,
        },
        tx,
      );
    });
    return this.adminClaim(claimId);
  }

  /** Turns the claim down; its commissions become claimable again with better evidence. */
  async reject(actorId: string, claimId: string, dto: ReviewNoteDto, meta: RequestMeta) {
    const claim = await this.claimOf(claimId);
    this.assertInReview(claim.status);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.commissionClaim.updateMany({
        where: { id: claimId, status: claim.status },
        data: { status: 'REJECTED', reviewedBy: actorId, reviewedAt: new Date(), reviewNote: dto.note },
      });
      if (!count) throw this.claimChanged();
      await this.releaseCommissions(tx, claimId);
      await this.audit.record(
        {
          actorId,
          action: 'claim.rejected',
          entity: 'commission-claim',
          entityId: claimId,
          before: { status: claim.status },
          after: { status: 'REJECTED', note: dto.note },
          ...meta,
        },
        tx,
      );
    });
    return this.adminClaim(claimId);
  }

  /** Asks the partner for more: the claim goes back to them to add evidence and resubmit. */
  async dispute(actorId: string, claimId: string, dto: ReviewNoteDto, meta: RequestMeta) {
    const claim = await this.claimOf(claimId);
    if (claim.status !== 'SUBMITTED') {
      throw new ConflictException({ code: 'CLAIM_LOCKED', title: 'Only a submitted claim can be disputed' });
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.commissionClaim.updateMany({
        where: { id: claimId, status: 'SUBMITTED' },
        data: { status: 'DISPUTED', reviewedBy: actorId, reviewedAt: new Date(), reviewNote: dto.note },
      });
      if (!count) throw this.claimChanged();
      await tx.commission.updateMany({ where: { claimId, status: 'CLAIMED' }, data: { status: 'DISPUTED' } });
      await this.audit.record(
        {
          actorId,
          action: 'claim.disputed',
          entity: 'commission-claim',
          entityId: claimId,
          before: { status: 'SUBMITTED' },
          after: { status: 'DISPUTED', note: dto.note },
          ...meta,
        },
        tx,
      );
    });
    return this.adminClaim(claimId);
  }

  /** The stored file, for the claim's own franchise (franchiseId given) or for reviewers. */
  async evidenceFile(claimId: string, evidenceId: string, franchiseId?: string) {
    const evidence = await this.prisma.claimEvidence.findFirst({
      where: { id: evidenceId, claimId, ...(franchiseId ? { claim: { franchiseId } } : {}) },
    });
    if (!evidence) throw new NotFoundException({ code: 'EVIDENCE_NOT_FOUND', title: 'File not found' });
    return evidence;
  }

  // ---- Helpers ----

  private async claimOf(claimId: string, franchiseId?: string) {
    const claim = await this.prisma.commissionClaim.findFirst({
      where: { id: claimId, ...(franchiseId ? { franchiseId } : {}) },
      include: {
        franchise: { select: { id: true, name: true, code: true, bankName: true, ifsc: true } },
        evidence: { ...evidenceSummary, orderBy: { createdAt: 'asc' } },
        commissions: {
          orderBy: { createdAt: 'asc' },
          include: {
            order: {
              select: {
                orderNo: true,
                status: true,
                totalPaise: true,
                amountPaidPaise: true,
                paymentStatus: true,
                paymentMode: true,
                createdAt: true,
              },
            },
            payout: { select: { id: true, status: true, utr: true, paidAt: true } },
          },
        },
      },
    });
    if (!claim) throw new NotFoundException({ code: 'CLAIM_NOT_FOUND', title: 'Claim not found' });
    return claim;
  }

  private async detail(claim: Awaited<ReturnType<ClaimsService['claimOf']>>, forStaff: boolean) {
    const trail = await this.prisma.auditLog.findMany({
      where: { entity: 'commission-claim', entityId: claim.id },
      orderBy: { createdAt: 'asc' },
      select: {
        action: true,
        createdAt: true,
        after: true,
        actor: { select: { name: true, email: true, type: true } },
      },
    });
    return {
      ...this.toSummary({
        ...claim,
        _count: { commissions: claim.commissions.length, evidence: claim.evidence.length },
      }),
      franchise: forStaff ? claim.franchise : { id: claim.franchise.id, name: claim.franchise.name },
      note: claim.note,
      reviewNote: claim.reviewNote,
      reconciledReference: claim.reconciledReference,
      evidence: claim.evidence,
      commissions: claim.commissions.map((c) => ({
        id: c.id,
        status: c.status,
        source: c.source,
        amountPaise: paise(c.amountPaise),
        basePaise: paise(c.basePaise),
        order: {
          orderNo: c.order.orderNo,
          status: c.order.status,
          totalPaise: paise(c.order.totalPaise),
          amountPaidPaise: paise(c.order.amountPaidPaise),
          paymentStatus: c.order.paymentStatus,
          paymentMode: c.order.paymentMode,
          createdAt: c.order.createdAt,
        },
        payout: c.payout,
      })),
      history: trail.map((entry) => ({
        action: entry.action,
        at: entry.createdAt,
        // Partners see who at their franchise acted, and that the accounts team did; not staff names.
        by:
          forStaff || entry.actor?.type === 'FRANCHISE'
            ? (entry.actor?.name ?? entry.actor?.email ?? null)
            : 'Neon Adda accounts',
        note: (entry.after as { note?: string } | null)?.note ?? null,
      })),
    };
  }

  private toSummary(claim: {
    id: string;
    claimNo: string;
    status: ClaimStatus;
    amountPaise: bigint;
    createdAt: Date;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewNote: string | null;
    _count: { commissions: number; evidence: number };
  }) {
    return {
      id: claim.id,
      claimNo: claim.claimNo,
      status: claim.status,
      amountPaise: paise(claim.amountPaise),
      commissions: claim._count.commissions,
      evidenceFiles: claim._count.evidence,
      createdAt: claim.createdAt,
      submittedAt: claim.submittedAt,
      reviewedAt: claim.reviewedAt,
      reviewNote: claim.reviewNote,
    };
  }

  private async releaseCommissions(tx: Prisma.TransactionClient, claimId: string) {
    await tx.commission.updateMany({
      where: { claimId, status: { in: ['CLAIMED', 'DISPUTED'] } },
      data: { status: 'ELIGIBLE', claimId: null },
    });
  }

  private assertEditable(status: ClaimStatus) {
    if (!EDITABLE.includes(status)) {
      throw new ConflictException({
        code: 'CLAIM_LOCKED',
        title: 'This claim is with the accounts team and cannot be changed now',
      });
    }
  }

  private assertInReview(status: ClaimStatus) {
    if (!IN_REVIEW.includes(status)) {
      throw new ConflictException({
        code: 'CLAIM_LOCKED',
        title:
          status === 'DRAFT'
            ? 'This claim has not been submitted yet'
            : 'This claim has already been decided',
      });
    }
  }

  private claimChanged() {
    return new ConflictException({ code: 'CLAIM_CHANGED', title: 'This claim was just changed. Reload it.' });
  }

  private ledgerChanged() {
    return new ConflictException({
      code: 'LEDGER_CHANGED',
      title: 'The commission ledger changed. Try again.',
    });
  }
}
