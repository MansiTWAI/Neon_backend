import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';

const IST_OFFSET_MS = 5.5 * 3600_000;

/** Start and end of the current calendar day in India, as UTC instants. */
function todayInIndia(now = new Date()): { start: Date; end: Date } {
  const istMidnight = Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS;
  return { start: new Date(istMidnight), end: new Date(istMidnight + 86_400_000) };
}

@Controller('field')
@Authenticated(['technician'])
export class FieldServiceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('jobs/today')
  async todaysJobs(@CurrentAuth() auth: AccessClaims) {
    const { start, end } = todayInIndia();
    const jobs = await this.prisma.installationJob.findMany({
      where: {
        technicianId: auth.tid,
        scheduledStart: { gte: start, lt: end },
        status: { notIn: ['COMPLETED', 'FAILED'] },
      },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        order: { select: { orderNo: true, shippingAddress: true } },
      },
    });

    return jobs.map(({ order, ...job }) => ({
      ...job,
      orderNo: order.orderNo,
      address: order.shippingAddress,
    }));
  }
}
