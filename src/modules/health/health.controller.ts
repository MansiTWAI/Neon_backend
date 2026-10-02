import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(
      () => 'up' as const,
      () => 'down' as const,
    );
    return { status: 'ok', database, time: new Date().toISOString() };
  }

  /** Answers without touching the database, for uptime pings that should not keep it awake. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
