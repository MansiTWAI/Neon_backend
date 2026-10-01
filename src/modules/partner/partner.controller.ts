import { Controller, Get } from '@nestjs/common';
import { ruleScore } from '@neon-adda/shared';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';

/** Franchise partner endpoints. Every query is scoped to the caller's own franchise. */
@Controller('partner')
@Authenticated(['franchise'])
export class PartnerController {
  constructor(private readonly prisma: PrismaService) {}

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
        tier: { select: { name: true } },
        _count: {
          select: { territories: true, technicians: true, kioskDevices: { where: { revokedAt: null } } },
        },
      },
    });
    const { _count, tier, ...rest } = franchise;
    return {
      ...rest,
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
