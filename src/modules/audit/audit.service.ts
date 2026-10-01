import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEntry {
  actorId: string;
  /** Verb in the form `entity.action`, e.g. `order.payment-recorded`. */
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

type Db = Prisma.TransactionClient | PrismaService;

/** Who changed what in the back office. Written in the same transaction as the change when one is given. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          before: toJson(entry.before),
          after: toJson(entry.after),
          ip: entry.ip,
          userAgent: entry.userAgent?.slice(0, 500),
        },
      });
    } catch (error) {
      // Inside a transaction the failure must propagate; outside one, losing an audit row
      // should not undo a change that has already been made.
      if (db !== this.prisma) throw error;
      this.logger.error(`Could not record ${entry.action}`, error instanceof Error ? error.stack : error);
    }
  }

  trail(entity: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        after: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    });
  }
}

/** BigInt and Decimal are not JSON; audit rows store them as plain numbers. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? Number(v) : v,
    ),
  ) as Prisma.InputJsonValue;
}
