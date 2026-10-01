import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { pageOf, pageSchema, searchSchema, skipTake } from '../../../common/http/pagination';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';

const STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'] as const;

const listSchema = pageSchema.extend({
  status: z.enum(STATUSES).optional().catch(undefined),
  q: searchSchema,
});

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  franchiseId: z.string().uuid().nullable().optional(),
  followUpAt: z.coerce.date().nullable().optional(),
});
type UpdateLeadDto = z.infer<typeof updateSchema>;

@Controller('admin/leads')
@Authenticated(['admin'])
export class AdminLeadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('customers.read')
  async list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    const digits = query.q?.replace(/\D/g, '') ?? '';
    const where: Prisma.LeadWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { message: { contains: query.q, mode: 'insensitive' } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [leads, total, counts] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        include: { franchise: { select: { id: true, name: true } } },
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      ...pageOf(leads, total, query),
      counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])),
    };
  }

  @Patch(':id')
  @RequirePermissions('customers.read')
  async update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) dto: UpdateLeadDto,
    @Meta() meta: RequestMeta,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', title: 'Lead not found' });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: dto,
        include: { franchise: { select: { id: true, name: true } } },
      });
      await this.audit.record(
        {
          actorId: auth.sub,
          action: 'lead.updated',
          entity: 'lead',
          entityId: id,
          before: { status: lead.status, franchiseId: lead.franchiseId },
          after: dto,
          ...meta,
        },
        tx,
      );
      return updated;
    });
  }
}
