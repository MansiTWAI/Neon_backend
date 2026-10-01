import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { pageOf, pageSchema, searchSchema, skipTake } from '../../../common/http/pagination';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../../database/prisma.service';
import { Authenticated, RequirePermissions } from '../../auth/auth.decorators';

const listSchema = pageSchema.extend({ q: searchSchema });

@Controller('admin/customers')
@Authenticated(['admin'])
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('customers.read')
  async list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    const digits = query.q?.replace(/\D/g, '') ?? '';
    const where: Prisma.UserWhereInput = {
      type: 'CUSTOMER',
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };

    const [customers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const spend = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customers.map((c) => c.id) } },
      _sum: { amountPaidPaise: true },
    });
    const paidBy = new Map(spend.map((row) => [row.customerId, Number(row._sum.amountPaidPaise ?? 0)]));

    return pageOf(
      customers.map(({ _count, ...customer }) => ({
        ...customer,
        orders: _count.orders,
        paidPaise: paidBy.get(customer.id) ?? 0,
      })),
      total,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const customer = await this.prisma.user.findFirst({
      where: { id, type: 'CUSTOMER' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        addresses: { orderBy: { isDefault: 'desc' } },
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            orderNo: true,
            status: true,
            paymentStatus: true,
            totalPaise: true,
            amountPaidPaise: true,
            createdAt: true,
          },
        },
        quotations: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, quoteNo: true, version: true, status: true, createdAt: true },
        },
      },
    });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', title: 'Customer not found' });

    return {
      ...customer,
      orders: customer.orders.map((o) => ({
        ...o,
        totalPaise: Number(o.totalPaise),
        amountPaidPaise: Number(o.amountPaidPaise),
      })),
      paidPaise: customer.orders.reduce((sum, o) => sum + Number(o.amountPaidPaise), 0),
    };
  }
}
