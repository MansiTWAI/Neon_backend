import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ruleScore } from '@neon-adda/shared';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { orderNoSchema } from '../orders/orders.dto';
import {
  PartnerInstallationDto,
  partnerInstallationSchema,
  PartnerLeadListQuery,
  partnerLeadListSchema,
  PartnerLeadUpdateDto,
  partnerLeadUpdateSchema,
  PartnerOrderListQuery,
  partnerOrderListSchema,
  PartnerTechnicianDto,
  partnerTechnicianSchema,
} from './partner.dto';
import { PartnerService } from './partner.service';

const orderNo = new ZodValidationPipe(orderNoSchema);

/** Franchise partner endpoints. Every query is scoped to the caller's own franchise. */
@Controller('partner')
@Authenticated(['franchise'])
export class PartnerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partner: PartnerService,
  ) {}

  @Get('overview')
  overview(@CurrentAuth() auth: AccessClaims) {
    return this.partner.overview(auth.fid!);
  }

  @Get('orders')
  orders(
    @CurrentAuth() auth: AccessClaims,
    @Query(new ZodValidationPipe(partnerOrderListSchema)) query: PartnerOrderListQuery,
  ) {
    return this.partner.orders(auth.fid!, query);
  }

  @Get('orders/:orderNo')
  order(@CurrentAuth() auth: AccessClaims, @Param('orderNo', orderNo) no: string) {
    return this.partner.order(auth.fid!, no);
  }

  @Put('orders/:orderNo/installation')
  scheduleInstallation(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(partnerInstallationSchema)) dto: PartnerInstallationDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.partner.scheduleInstallation(auth.sub, auth.fid!, no, dto, meta);
  }

  @Get('installations')
  installations(@CurrentAuth() auth: AccessClaims) {
    return this.partner.installations(auth.fid!);
  }

  @Get('technicians')
  technicians(@CurrentAuth() auth: AccessClaims) {
    return this.partner.technicians(auth.fid!);
  }

  @Post('technicians')
  addTechnician(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(partnerTechnicianSchema)) dto: PartnerTechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.partner.saveTechnician(auth.sub, auth.fid!, null, dto, meta);
  }

  @Put('technicians/:id')
  updateTechnician(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(partnerTechnicianSchema)) dto: PartnerTechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.partner.saveTechnician(auth.sub, auth.fid!, id, dto, meta);
  }

  @Get('leads')
  leads(
    @CurrentAuth() auth: AccessClaims,
    @Query(new ZodValidationPipe(partnerLeadListSchema)) query: PartnerLeadListQuery,
  ) {
    return this.partner.leads(auth.fid!, query);
  }

  @Patch('leads/:id')
  updateLead(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(partnerLeadUpdateSchema)) dto: PartnerLeadUpdateDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.partner.updateLead(auth.sub, auth.fid!, id, dto, meta);
  }

  @Get('commission')
  commission(@CurrentAuth() auth: AccessClaims) {
    return this.partner.commissionLedger(auth.fid!);
  }

  @Get('profile')
  async profile(@CurrentAuth() auth: AccessClaims) {
    const franchise = await this.prisma.franchise.findUniqueOrThrow({
      where: { id: auth.fid },
      select: {
        id: true,
        code: true,
        name: true,
        city: true,
        status: true,
        phone: true,
        email: true,
        gstin: true,
        address: true,
        bankName: true,
        ifsc: true,
        kycVerifiedAt: true,
        tier: { select: { name: true } },
        _count: {
          select: { territories: true, technicians: true, kioskDevices: { where: { revokedAt: null } } },
        },
      },
    });
    const { _count, tier, address, ...rest } = franchise;
    return {
      ...rest,
      address: (address as { text?: string } | null)?.text ?? null,
      tier: tier?.name ?? null,
      pincodes: _count.territories,
      technicians: _count.technicians,
      kioskDevices: _count.kioskDevices,
    };
  }

  /** The rules that can apply to this franchise's orders, most specific first. */
  @Get('commission-rules')
  async commissionRules(@CurrentAuth() auth: AccessClaims) {
    const franchise = await this.prisma.franchise.findUniqueOrThrow({
      where: { id: auth.fid },
      select: { tierId: true },
    });
    const now = new Date();

    const rules = await this.prisma.commissionRule.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          {
            OR: [
              { scope: 'DEFAULT' },
              { scope: 'FRANCHISE', franchiseId: auth.fid },
              ...(franchise.tierId ? [{ scope: 'TIER' as const, tierId: franchise.tierId }] : []),
            ],
          },
        ],
      },
      include: { tier: { select: { name: true } }, category: { select: { name: true } } },
    });

    return rules
      .map((rule) => ({
        id: rule.id,
        appliesTo:
          rule.scope === 'FRANCHISE'
            ? 'Your franchise'
            : rule.scope === 'TIER'
              ? `${rule.tier?.name} tier`
              : 'All partners',
        category: rule.category?.name ?? 'All products',
        source: rule.source,
        type: rule.type,
        value: Number(rule.value),
        maxPerOrderPaise: rule.maxPerOrderPaise == null ? null : Number(rule.maxPerOrderPaise),
        effectiveFrom: rule.effectiveFrom,
        score: ruleScore({
          id: rule.id,
          scope: rule.scope,
          categoryId: rule.categoryId,
          source: rule.source,
          type: rule.type,
          value: Number(rule.value),
          priority: rule.priority,
          effectiveFrom: rule.effectiveFrom,
          isActive: rule.isActive,
        }),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
