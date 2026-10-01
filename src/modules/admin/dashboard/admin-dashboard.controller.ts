import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Authenticated, RequirePermissions } from '../../auth/auth.decorators';
import { AdminOrdersService } from '../orders/admin-orders.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Midnight in India, as a UTC instant. */
function istMidnight(daysAgo = 0): Date {
  const now = Date.now() + IST_OFFSET_MS;
  return new Date(now - (now % DAY) - IST_OFFSET_MS - daysAgo * DAY);
}

function istMonthStart(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

@Controller('admin/dashboard')
@Authenticated(['admin'])
export class AdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: AdminOrdersService,
  ) {}

  @Get()
  @RequirePermissions('dashboard.read')
  async summary() {
    const today = istMidnight();
    const month = istMonthStart();
    const fortnight = istMidnight(13);
    const captured = { status: 'CAPTURED' as const };

    const [
      ordersToday,
      ordersMonth,
      paidToday,
      paidMonth,
      queues,
      openQuotes,
      openTickets,
      newLeads,
      daily,
      recent,
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.order.count({ where: { createdAt: { gte: month } } }),
      this.prisma.payment.aggregate({
        where: { ...captured, capturedAt: { gte: today } },
        _sum: { amountPaise: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...captured, capturedAt: { gte: month } },
        _sum: { amountPaise: true },
      }),
      this.orders.queueCounts(),
      this.prisma.quotation.count({ where: { status: { in: ['REQUESTED', 'CHANGES_REQUESTED'] } } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.lead.count({ where: { status: 'NEW' } }),
      this.prisma.$queryRaw<{ day: string; amount: bigint }[]>`
          SELECT to_char("capturedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
                 SUM("amountPaise")::bigint AS amount
          FROM payments
          WHERE status = 'CAPTURED' AND "capturedAt" >= ${fortnight}
          GROUP BY 1`,
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          orderNo: true,
          status: true,
          paymentStatus: true,
          totalPaise: true,
          createdAt: true,
          customer: { select: { name: true, phone: true } },
        },
      }),
    ]);

    const byDay = new Map(daily.map((row) => [row.day, Number(row.amount)]));
    return {
      today: { orders: ordersToday, collectedPaise: Number(paidToday._sum.amountPaise ?? 0) },
      month: { orders: ordersMonth, collectedPaise: Number(paidMonth._sum.amountPaise ?? 0) },
      queues: { ...queues, quotesToPrepare: openQuotes, openTickets, newLeads },
      collections: Array.from({ length: 14 }, (_, i) => {
        const day = new Date(fortnight.getTime() + IST_OFFSET_MS + i * DAY).toISOString().slice(0, 10);
        return { day, amountPaise: byDay.get(day) ?? 0 };
      }),
      recentOrders: recent.map((order) => ({ ...order, totalPaise: Number(order.totalPaise) })),
    };
  }
}
