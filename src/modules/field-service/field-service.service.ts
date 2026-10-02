import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatINR } from '@neon-adda/shared';
import { JobPhotoStage, JobStatus, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AddressSnapshot } from '../orders/address-snapshot';
import { ImageType, StorageService } from '../storage/storage.service';
import { completionCode } from './completion-code';
import { CompleteJobDto, FailJobDto, JobListQuery, JobStep } from './field-service.dto';

const paise = (value: bigint) => Number(value);

/** Where a visit can be moved from, for each step the technician takes. */
const STEP_FROM: Record<JobStep, readonly JobStatus[]> = {
  ACCEPTED: ['SCHEDULED', 'RESCHEDULED'],
  ON_THE_WAY: ['ACCEPTED'],
  REACHED: ['ON_THE_WAY'],
  WORK_STARTED: ['REACHED'],
};

const OPEN: readonly JobStatus[] = [
  'SCHEDULED',
  'RESCHEDULED',
  'ACCEPTED',
  'ON_THE_WAY',
  'REACHED',
  'WORK_STARTED',
];
const CLOSED: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** Orders whose sign has left the workshop, so it can be put up. */
const INSTALLABLE_ORDER = ['SHIPPED', 'DELIVERED'] as const;

const jobInclude = {
  order: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      customerId: true,
      paymentMode: true,
      amountDuePaise: true,
      amountPaidPaise: true,
      totalPaise: true,
      shippingAddress: true,
      items: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          description: true,
          widthIn: true,
          heightIn: true,
          qty: true,
          design: { select: { previewKey: true } },
        },
      },
    },
  },
  photos: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.InstallationJobInclude;

type Job = Prisma.InstallationJobGetPayload<{ include: typeof jobInclude }>;

@Injectable()
export class FieldServiceService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('JWT_SECRET', { infer: true });
  }

  async list(technicianId: string, { scope }: JobListQuery) {
    const upcoming = scope === 'upcoming';
    const jobs = await this.prisma.installationJob.findMany({
      where: {
        technicianId,
        status: { in: [...(upcoming ? OPEN : CLOSED)] },
        ...(upcoming ? { scheduledStart: { not: null } } : {}),
      },
      orderBy: upcoming ? { scheduledStart: 'asc' } : { updatedAt: 'desc' },
      take: upcoming ? 100 : 50,
      include: jobInclude,
    });
    return jobs.map((job) => this.summary(job));
  }

  async detail(technicianId: string, jobId: string) {
    const job = await this.load(technicianId, jobId);
    const address = job.order.shippingAddress as AddressSnapshot;
    return {
      ...this.summary(job),
      notes: job.notes,
      failReason: job.failReason,
      customer: { name: address.name, phone: address.phone },
      items: job.order.items.map((item) => ({
        id: item.id,
        description: item.description,
        widthIn: Number(item.widthIn),
        heightIn: Number(item.heightIn),
        qty: item.qty,
        previewUrl: this.storage.url(item.design?.previewKey),
      })),
      photos: job.photos.map((photo) => ({
        id: photo.id,
        stage: photo.stage,
        url: this.storage.url(photo.fileKey),
        at: photo.createdAt,
      })),
      payment: {
        mode: job.order.paymentMode,
        totalPaise: paise(job.order.totalPaise),
        duePaise: paise(job.order.amountDuePaise),
      },
    };
  }

  async step(technicianId: string, jobId: string, to: JobStep) {
    const job = await this.load(technicianId, jobId);
    if (!STEP_FROM[to].includes(job.status)) {
      throw new ConflictException({
        code: 'INVALID_STEP',
        title: `This visit is ${label(job.status)}, so it cannot be marked ${label(to)}`,
      });
    }
    if (to === 'ON_THE_WAY' && !INSTALLABLE_ORDER.includes(job.order.status as never)) {
      throw new ConflictException({
        code: 'SIGN_NOT_DISPATCHED',
        title: 'The sign for this order has not left the workshop yet',
      });
    }

    const { count } = await this.prisma.installationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: to },
    });
    if (!count) throw changedMeanwhile();

    if (to === 'ON_THE_WAY') {
      await this.notifyCustomer(
        job,
        'Technician on the way',
        'Your installer has set out and will reach you soon.',
      );
    }
    if (to === 'WORK_STARTED') {
      await this.notifyCustomer(
        job,
        'Installation started',
        'When the sign is up and working, share the code on your order page with the technician.',
      );
    }
    return this.detail(technicianId, jobId);
  }

  async addPhoto(
    technicianId: string,
    jobId: string,
    stage: JobPhotoStage,
    file: { body: Buffer; type: ImageType },
  ) {
    const job = await this.load(technicianId, jobId);
    if (CLOSED.includes(job.status)) {
      throw new ConflictException({ code: 'JOB_CLOSED', title: 'This visit is already closed' });
    }
    if (job.photos.length >= 30) {
      throw new UnprocessableEntityException({
        code: 'TOO_MANY_PHOTOS',
        title: 'A visit can have up to 30 photos',
      });
    }
    const fileKey = await this.storage.put('jobs', file.body, file.type);
    await this.prisma.jobPhoto.create({ data: { jobId: job.id, stage, fileKey } });
    return this.detail(technicianId, jobId);
  }

  /**
   * The customer's code proves they saw the finished sign. It closes the visit, marks the order
   * installed and, for cash on delivery, records what was collected at the door.
   */
  async complete(technicianId: string, userId: string, jobId: string, dto: CompleteJobDto) {
    const job = await this.load(technicianId, jobId);
    if (job.status !== 'WORK_STARTED') {
      throw new ConflictException({
        code: 'INVALID_STEP',
        title: 'Start the work before completing the visit',
      });
    }
    if (!job.photos.some((photo) => photo.stage === 'AFTER')) {
      throw new UnprocessableEntityException({
        code: 'AFTER_PHOTO_REQUIRED',
        title: 'Add a photo of the finished, lit sign first',
      });
    }
    const expected = Buffer.from(completionCode(job.id, this.secret));
    if (!timingSafeEqual(expected, Buffer.from(dto.code))) {
      throw new UnprocessableEntityException({
        code: 'WRONG_CODE',
        title: 'That code does not match. Ask the customer to check their order page.',
        field: 'code',
      });
    }
    const due = job.order.amountDuePaise;
    if (dto.collected !== 'NONE' && due <= 0n) {
      throw new UnprocessableEntityException({ code: 'NOTHING_DUE', title: 'Nothing is due on this order' });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.installationJob.updateMany({
        where: { id: job.id, status: 'WORK_STARTED' },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          notes: dto.notes ? [job.notes, `Technician: ${dto.notes}`].filter(Boolean).join('\n\n') : job.notes,
        },
      });
      if (!count) throw changedMeanwhile();

      if (dto.collected !== 'NONE') {
        await tx.payment.create({
          data: {
            orderId: job.order.id,
            purpose: job.order.amountPaidPaise === 0n ? 'FULL' : 'BALANCE',
            method: dto.collected === 'CASH' ? 'OFFLINE_CASH' : 'OFFLINE_UPI',
            amountPaise: due,
            status: 'CAPTURED',
            reference: `Collected at installation by technician`,
            recordedBy: userId,
            capturedAt: now,
          },
        });
        await tx.order.update({
          where: { id: job.order.id },
          data: { amountPaidPaise: job.order.totalPaise, amountDuePaise: 0n, paymentStatus: 'PAID' },
        });
      }

      if (INSTALLABLE_ORDER.includes(job.order.status as never)) {
        await tx.order.update({ where: { id: job.order.id }, data: { status: 'INSTALLED' } });
        await tx.orderStatusHistory.create({
          data: {
            orderId: job.order.id,
            fromStatus: job.order.status,
            toStatus: 'INSTALLED',
            actorId: userId,
            actorType: 'TECHNICIAN',
            note: 'Confirmed by the customer with their completion code',
          },
        });
      }
    });

    await this.notifyCustomer(
      job,
      'Your sign is installed',
      dto.collected === 'NONE'
        ? 'Thank you for choosing Neon Adda. Tell us how it went from your order page.'
        : `We received ${formatINR(paise(due))}. Thank you for choosing Neon Adda.`,
    );
    return this.detail(technicianId, jobId);
  }

  async fail(technicianId: string, jobId: string, dto: FailJobDto) {
    const job = await this.load(technicianId, jobId);
    if (!['ACCEPTED', 'ON_THE_WAY', 'REACHED', 'WORK_STARTED'].includes(job.status)) {
      throw new ConflictException({
        code: 'INVALID_STEP',
        title: 'Only a visit you have accepted can be reported',
      });
    }
    const { count } = await this.prisma.installationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: 'FAILED', failReason: dto.reason },
    });
    if (!count) throw changedMeanwhile();
    await this.notifyCustomer(
      job,
      'Installation to be rescheduled',
      'We could not finish your installation this time. Our team will call you to book a new visit.',
    );
    return this.detail(technicianId, jobId);
  }

  /** Shown on the customer's order page while a visit is under way. */
  codeFor(jobId: string): string {
    return completionCode(jobId, this.secret);
  }

  private async load(technicianId: string, jobId: string): Promise<Job> {
    const job = await this.prisma.installationJob.findFirst({
      where: { id: jobId, technicianId },
      include: jobInclude,
    });
    if (!job)
      throw new NotFoundException({ code: 'JOB_NOT_FOUND', title: 'This visit is not assigned to you' });
    return job;
  }

  private summary(job: Job) {
    const address = job.order.shippingAddress as AddressSnapshot;
    return {
      id: job.id,
      status: job.status,
      scheduledStart: job.scheduledStart,
      scheduledEnd: job.scheduledEnd,
      completedAt: job.completedAt,
      orderNo: job.order.orderNo,
      orderStatus: job.order.status,
      customerName: address.name,
      address: {
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        pincode: address.pincode,
      },
      signs: job.order.items.reduce((sum, item) => sum + item.qty, 0),
      duePaise: paise(job.order.amountDuePaise),
    };
  }

  private notifyCustomer(job: Job, title: string, body: string) {
    return this.notifications.notify(
      job.order.customerId,
      { kind: 'order.updated', title, body, link: `/orders/${job.order.orderNo}` },
      ['customer'],
    );
  }
}

const label = (status: string) => status.replaceAll('_', ' ').toLowerCase();

const changedMeanwhile = () =>
  new ConflictException({ code: 'JOB_CHANGED', title: 'This visit was just updated. Refresh to see it.' });
