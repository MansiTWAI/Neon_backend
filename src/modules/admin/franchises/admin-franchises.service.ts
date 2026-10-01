import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { Prisma } from '@prisma/client';
import { RequestMeta } from '../../../common/http/request-meta';
import { temporaryPassword } from '../../../common/security/temporary-password';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { translateUnique } from '../pricing/admin-pricing.service';
import { CreateFranchiseDto, FranchiseDto, TechnicianDto, TerritoryDto } from './admin-franchises.dto';

const paise = (value: bigint | null | undefined) => Number(value ?? 0);

@Injectable()
export class AdminFranchisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  tiers() {
    return this.prisma.franchiseTier.findMany({ orderBy: { sort: 'asc' }, select: { id: true, name: true } });
  }

  async list(q?: string) {
    const franchises = await this.prisma.franchise.findMany({
      where: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q.toUpperCase() } },
                { city: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        tier: { select: { name: true } },
        owner: { select: { name: true, email: true } },
        _count: { select: { territories: true, technicians: true, orders: true } },
      },
    });
    const owed = await this.prisma.commission.groupBy({
      by: ['franchiseId'],
      where: { status: { in: ['PENDING', 'ELIGIBLE', 'APPROVED'] } },
      _sum: { amountPaise: true },
    });
    const owedBy = new Map(owed.map((row) => [row.franchiseId, paise(row._sum.amountPaise)]));

    return franchises.map(({ _count, tier, owner, ...franchise }) => ({
      id: franchise.id,
      code: franchise.code,
      name: franchise.name,
      city: franchise.city,
      status: franchise.status,
      tier: tier?.name ?? null,
      owner,
      pincodes: _count.territories,
      technicians: _count.technicians,
      orders: _count.orders,
      commissionOwedPaise: owedBy.get(franchise.id) ?? 0,
    }));
  }

  async detail(id: string) {
    const franchise = await this.prisma.franchise.findFirst({
      where: { id, deletedAt: null },
      include: {
        tier: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true, lastLoginAt: true, totpSecret: true } },
        territories: { orderBy: { pincode: 'asc' }, select: { pincode: true } },
        technicians: { orderBy: { name: 'asc' } },
        kioskDevices: { where: { revokedAt: null }, select: { id: true, name: true, lastSeenAt: true } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { orderNo: true, status: true, totalPaise: true, createdAt: true, attributionSource: true },
        },
      },
    });
    if (!franchise)
      throw new NotFoundException({ code: 'FRANCHISE_NOT_FOUND', title: 'Franchise not found' });

    const [sales, commission] = await Promise.all([
      this.prisma.order.aggregate({
        where: { franchiseId: id, status: { notIn: ['CANCELLED', 'EXPIRED', 'PENDING_PAYMENT'] } },
        _sum: { taxablePaise: true },
        _count: true,
      }),
      this.prisma.commission.groupBy({
        by: ['status'],
        where: { franchiseId: id },
        _sum: { amountPaise: true },
      }),
    ]);

    const { owner, territories, orders, address, panEnc: _pan, bankAccountEnc: _bank, ...rest } = franchise;
    return {
      ...rest,
      maxQuoteDiscountPct: Number(rest.maxQuoteDiscountPct),
      address: (address as { text?: string } | null)?.text ?? null,
      owner: owner && {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        lastLoginAt: owner.lastLoginAt,
        twoFactorEnabled: Boolean(owner.totpSecret),
      },
      pincodes: territories.map((t) => t.pincode),
      recentOrders: orders.map((o) => ({ ...o, totalPaise: paise(o.totalPaise) })),
      stats: {
        orders: sales._count,
        salesPaise: paise(sales._sum.taxablePaise),
        commission: Object.fromEntries(commission.map((row) => [row.status, paise(row._sum.amountPaise)])),
      },
    };
  }

  /** Creates the franchise and its owner's sign-in. The temporary password is returned once. */
  async create(actorId: string, dto: CreateFranchiseDto, meta: RequestMeta) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.owner.email } });
    if (existing)
      throw new ConflictException({ code: 'EMAIL_TAKEN', title: 'An account already uses this email' });

    const password = temporaryPassword();
    const passwordHash = await hash(password);
    const { owner, ...fields } = dto;

    try {
      const franchise = await this.prisma.$transaction(async (tx) => {
        const created = await tx.franchise.create({ data: this.data(fields) });
        const user = await tx.user.create({
          data: {
            type: 'FRANCHISE',
            name: owner.name,
            email: owner.email,
            passwordHash,
            franchiseId: created.id,
          },
        });
        await tx.franchise.update({ where: { id: created.id }, data: { ownerUserId: user.id } });
        await this.audit.record(
          {
            actorId,
            action: 'franchise.created',
            entity: 'franchise',
            entityId: created.id,
            after: dto,
            ...meta,
          },
          tx,
        );
        return created;
      });
      return { id: franchise.id, ownerEmail: owner.email, temporaryPassword: password };
    } catch (error) {
      throw translateUnique(error, 'Another franchise already uses this code');
    }
  }

  async update(actorId: string, id: string, dto: FranchiseDto, meta: RequestMeta) {
    await this.exists(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.franchise.update({ where: { id }, data: this.data(dto) });
        await this.audit.record(
          { actorId, action: 'franchise.updated', entity: 'franchise', entityId: id, after: dto, ...meta },
          tx,
        );
      });
    } catch (error) {
      throw translateUnique(error, 'Another franchise already uses this code');
    }
    return this.detail(id);
  }

  /** A pincode belongs to one franchise. Clashes are reported unless the caller asks to reassign them. */
  async territories(actorId: string, id: string, dto: TerritoryDto, meta: RequestMeta) {
    await this.exists(id);
    const add = [...new Set(dto.add)];
    const clashes = await this.prisma.franchiseTerritory.findMany({
      where: { pincode: { in: add }, franchiseId: { not: id } },
      select: { pincode: true, franchise: { select: { name: true } } },
    });
    if (clashes.length && !dto.reassign) {
      throw new ConflictException({
        code: 'PINCODES_TAKEN',
        title:
          clashes.length === 1
            ? `${clashes[0]!.pincode} belongs to ${clashes[0]!.franchise.name}`
            : `${clashes.length} of these pincodes belong to other franchises`,
        clashes: clashes.map((c) => ({ pincode: c.pincode, franchise: c.franchise.name })),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.remove.length)
        await tx.franchiseTerritory.deleteMany({ where: { franchiseId: id, pincode: { in: dto.remove } } });
      if (add.length) {
        await tx.franchiseTerritory.deleteMany({ where: { pincode: { in: add } } });
        await tx.franchiseTerritory.createMany({
          data: add.map((pincode) => ({ franchiseId: id, pincode })),
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'franchise.territory-changed',
          entity: 'franchise',
          entityId: id,
          after: dto,
          ...meta,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  async saveTechnician(
    actorId: string,
    franchiseId: string,
    technicianId: string | null,
    dto: TechnicianDto,
    meta: RequestMeta,
  ) {
    await this.exists(franchiseId);
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
    return this.detail(franchiseId);
  }

  /** Issues a new temporary password and signs the owner out everywhere. */
  async resetOwnerPassword(actorId: string, id: string, meta: RequestMeta) {
    const franchise = await this.exists(id);
    if (!franchise.ownerUserId)
      throw new NotFoundException({ code: 'NO_OWNER', title: 'This franchise has no owner account' });

    const password = temporaryPassword();
    const passwordHash = await hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: franchise.ownerUserId! },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: franchise.ownerUserId!, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { actorId, action: 'franchise.owner-password-reset', entity: 'franchise', entityId: id, ...meta },
        tx,
      );
    });
    return { temporaryPassword: password };
  }

  private data(dto: FranchiseDto): Prisma.FranchiseUncheckedCreateInput {
    const { address, ...fields } = dto;
    return {
      ...fields,
      address: address ? { text: address } : Prisma.JsonNull,
      ...(dto.status === 'ACTIVE' ? { kycVerifiedAt: new Date() } : {}),
    };
  }

  private async exists(id: string) {
    const franchise = await this.prisma.franchise.findFirst({ where: { id, deletedAt: null } });
    if (!franchise)
      throw new NotFoundException({ code: 'FRANCHISE_NOT_FOUND', title: 'Franchise not found' });
    return franchise;
  }
}
