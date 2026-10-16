import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TechnicianStatus } from '@prisma/client';
import { pageOf, skipTake } from '../../../common/http/pagination';
import type { RequestMeta } from '../../../common/http/request-meta';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AddressSnapshot } from '../../orders/address-snapshot';
import { translateUnique } from '../pricing/admin-pricing.service';
import {
  CandidatesQuery,
  CreateTechnicianDto,
  SuspendTechnicianDto,
  TechnicianDetailsDto,
  TechnicianListQuery,
} from './admin-technicians.dto';
import {
  areaMatch,
  BOOKED_STATUSES,
  candidateScore,
  hasInstallSkill,
  STARTED_STATUSES,
} from './technician-matching';

const OPEN_JOB_STATUSES = ['UNASSIGNED', ...BOOKED_STATUSES] as const;

/**
 * The admin team's technician roster. Technicians are added and approved here, and only active
 * ones can sign in or be given visits. Franchises no longer manage technicians.
 */
@Injectable()
export class AdminTechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: TechnicianListQuery) {
    const where: Prisma.TechnicianWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q.replace(/\s/g, '') } },
              { serviceCity: { contains: query.q, mode: 'insensitive' } },
              { servicePincodes: { has: query.q } },
            ],
          }
        : {}),
    };
    const [technicians, total, counts] = await Promise.all([
      this.prisma.technician.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        ...skipTake(query),
        include: {
          franchise: { select: { id: true, name: true } },
          _count: { select: { jobs: { where: { status: 'COMPLETED' } } } },
          jobs: { where: { status: { in: [...OPEN_JOB_STATUSES] } }, select: { id: true } },
        },
      }),
      this.prisma.technician.count({ where }),
      this.prisma.technician.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      ...pageOf(
        technicians.map((t) => this.toView(t)),
        total,
        query,
      ),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async detail(id: string) {
    const technician = await this.prisma.technician.findUnique({
      where: { id },
      include: {
        franchise: { select: { id: true, name: true } },
        _count: { select: { jobs: { where: { status: 'COMPLETED' } } } },
        jobs: {
          where: {
            OR: [
              { status: { in: [...OPEN_JOB_STATUSES] } },
              { updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
            ],
          },
          orderBy: [{ scheduledStart: { sort: 'asc', nulls: 'last' } }],
          take: 50,
          include: { order: { select: { orderNo: true, shippingAddress: true } } },
        },
      },
    });
    if (!technician) throw this.notFound();
    const trail = await this.audit.trail('technician', id);
    return {
      ...this.toView({
        ...technician,
        jobs: technician.jobs.filter((j) => (OPEN_JOB_STATUSES as readonly string[]).includes(j.status)),
      }),
      jobs: technician.jobs.map((job) => {
        const address = job.order.shippingAddress as AddressSnapshot;
        return {
          id: job.id,
          status: job.status,
          orderNo: job.order.orderNo,
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
          city: address.city,
          pincode: address.pincode,
        };
      }),
      history: trail,
    };
  }

  async create(actorId: string, dto: CreateTechnicianDto, meta: RequestMeta) {
    const { approve, ...details } = dto;
    await this.assertFranchise(details.franchiseId);
    const status: TechnicianStatus = approve ? 'ACTIVE' : 'PENDING';
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const technician = await tx.technician.create({
          data: { ...details, status, isActive: status === 'ACTIVE' },
        });
        await this.audit.record(
          {
            actorId,
            action: 'technician.added',
            entity: 'technician',
            entityId: technician.id,
            after: { ...details, status },
            ...meta,
          },
          tx,
        );
        return technician.id;
      });
      return this.detail(id);
    } catch (error) {
      throw translateUnique(error, 'This mobile number is already registered to a technician');
    }
  }

  async update(actorId: string, id: string, dto: TechnicianDetailsDto, meta: RequestMeta) {
    const before = await this.prisma.technician.findUnique({ where: { id } });
    if (!before) throw this.notFound();
    await this.assertFranchise(dto.franchiseId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.technician.update({ where: { id }, data: dto });
        await this.audit.record(
          {
            actorId,
            action: 'technician.updated',
            entity: 'technician',
            entityId: id,
            before: {
              name: before.name,
              phone: before.phone,
              skills: before.skills,
              serviceCity: before.serviceCity,
              servicePincodes: before.servicePincodes,
              franchiseId: before.franchiseId,
            },
            after: dto,
            ...meta,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateUnique(error, 'This mobile number is already registered to a technician');
    }
    return this.detail(id);
  }

  /** Approves a new technician, or brings back a suspended one. */
  async activate(actorId: string, id: string, meta: RequestMeta) {
    const technician = await this.prisma.technician.findUnique({ where: { id } });
    if (!technician) throw this.notFound();
    if (technician.status === 'ACTIVE') {
      throw new ConflictException({ code: 'ALREADY_ACTIVE', title: 'This technician is already active' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({ where: { id }, data: { status: 'ACTIVE', isActive: true } });
      await this.audit.record(
        {
          actorId,
          action: technician.status === 'PENDING' ? 'technician.approved' : 'technician.reactivated',
          entity: 'technician',
          entityId: id,
          before: { status: technician.status },
          after: { status: 'ACTIVE' },
          ...meta,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  /**
   * Stops a technician working: they are signed out everywhere, cannot sign in, and their visits
   * that have not started go back to the unassigned queue for someone else.
   */
  async suspend(actorId: string, id: string, dto: SuspendTechnicianDto, meta: RequestMeta) {
    const technician = await this.prisma.technician.findUnique({ where: { id } });
    if (!technician) throw this.notFound();
    if (technician.status === 'SUSPENDED') {
      throw new ConflictException({
        code: 'ALREADY_SUSPENDED',
        title: 'This technician is already suspended',
      });
    }
    const started = await this.prisma.installationJob.count({
      where: { technicianId: id, status: { in: STARTED_STATUSES } },
    });
    if (started) {
      throw new UnprocessableEntityException({
        code: 'VISIT_UNDER_WAY',
        title: 'This technician is on a visit now. Wait until it is finished or failed, then suspend.',
      });
    }
    const released = await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({ where: { id }, data: { status: 'SUSPENDED', isActive: false } });
      if (technician.userId) {
        await tx.session.updateMany({
          where: { userId: technician.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const { count } = await tx.installationJob.updateMany({
        where: { technicianId: id, status: { in: ['SCHEDULED', 'RESCHEDULED', 'ACCEPTED'] } },
        data: { technicianId: null, status: 'UNASSIGNED' },
      });
      await this.audit.record(
        {
          actorId,
          action: 'technician.suspended',
          entity: 'technician',
          entityId: id,
          before: { status: technician.status },
          after: { status: 'SUSPENDED', reason: dto.reason, note: dto.reason, visitsReleased: count },
          ...meta,
        },
        tx,
      );
      return count;
    });
    return { ...(await this.detail(id)), visitsReleased: released };
  }

  /**
   * Active technicians for an order's visit, best first: free at the requested time, covering the
   * address, with the installation skill and the fewest open visits.
   */
  async candidates(orderNo: string, query: CandidatesQuery) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      select: {
        franchiseId: true,
        shippingAddress: true,
        installationJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', title: 'Order not found' });
    const address = order.shippingAddress as AddressSnapshot;
    const jobId = order.installationJobs[0]?.id;
    const start = query.start;
    const end = start ? new Date(start.getTime() + query.durationHours * 3600_000) : null;

    const technicians = await this.prisma.technician.findMany({
      where: { status: 'ACTIVE' },
      include: {
        franchise: { select: { name: true } },
        jobs: {
          where: { status: { in: [...BOOKED_STATUSES] }, ...(jobId ? { id: { not: jobId } } : {}) },
          select: { scheduledStart: true, scheduledEnd: true },
        },
      },
    });
    return technicians
      .map((t) => {
        const area = areaMatch(t, address, order.franchiseId);
        const clashes =
          start && end
            ? t.jobs.filter(
                (j) => j.scheduledStart && j.scheduledEnd && j.scheduledStart < end && j.scheduledEnd > start,
              ).length
            : 0;
        const installs = hasInstallSkill(t.skills);
        return {
          id: t.id,
          name: t.name,
          phone: t.phone,
          franchise: t.franchise?.name ?? null,
          skills: t.skills,
          serviceCity: t.serviceCity,
          area,
          openJobs: t.jobs.length,
          /** Null when no time was given, so availability is unknown. */
          free: start ? clashes === 0 : null,
          score: candidateScore({ area, free: clashes === 0, installs, openJobs: t.jobs.length }),
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  private toView(t: {
    id: string;
    name: string;
    phone: string;
    status: TechnicianStatus;
    skills: string[];
    serviceCity: string | null;
    servicePincodes: string[];
    userId: string | null;
    createdAt: Date;
    franchise: { id: string; name: string } | null;
    _count: { jobs: number };
    jobs: unknown[];
  }) {
    return {
      id: t.id,
      name: t.name,
      phone: t.phone,
      status: t.status,
      skills: t.skills,
      serviceCity: t.serviceCity,
      servicePincodes: t.servicePincodes,
      franchise: t.franchise,
      hasSignedIn: Boolean(t.userId),
      completedJobs: t._count.jobs,
      openJobs: t.jobs.length,
      createdAt: t.createdAt,
    };
  }

  private async assertFranchise(franchiseId: string | null) {
    if (
      franchiseId &&
      !(await this.prisma.franchise.count({ where: { id: franchiseId, deletedAt: null } }))
    ) {
      throw new UnprocessableEntityException({
        code: 'FRANCHISE_NOT_FOUND',
        title: 'Choose an existing franchise',
        field: 'franchiseId',
      });
    }
  }

  private notFound() {
    return new NotFoundException({ code: 'TECHNICIAN_NOT_FOUND', title: 'Technician not found' });
  }
}
