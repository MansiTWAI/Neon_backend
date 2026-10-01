import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Audience } from '../auth/auth.types';
import { FirebaseMessagingService, PushMessage } from './firebase-messaging.service';

export interface Notice extends PushMessage {
  /** Stable identifier for the kind of notice, e.g. `auth.new-sign-in`. */
  kind: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseMessagingService,
  ) {}

  get pushEnabled(): boolean {
    return this.firebase.enabled;
  }

  /**
   * Records the notice in the user's inbox and pushes it to their registered devices.
   * Push is best effort: a Firebase outage must never fail the action that caused the notice.
   */
  async notify(userId: string, notice: Notice, apps?: Audience[]): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        recipient: userId,
        channel: 'IN_APP',
        templateKey: notice.kind,
        payload: { title: notice.title, body: notice.body, link: notice.link ?? null },
        status: 'DELIVERED',
      },
    });

    if (!this.firebase.enabled) return;

    try {
      const devices = await this.prisma.pushDevice.findMany({
        where: { userId, ...(apps ? { app: { in: apps } } : {}) },
        select: { token: true },
      });
      const { deadTokens } = await this.firebase.send(
        devices.map((device) => device.token),
        notice,
      );
      if (deadTokens.length) {
        await this.prisma.pushDevice.deleteMany({ where: { token: { in: deadTokens } } });
      }
    } catch (error) {
      this.logger.error(
        `Push delivery failed for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async registerDevice(userId: string, app: Audience, token: string, userAgent?: string) {
    await this.prisma.pushDevice.upsert({
      where: { token },
      update: { userId, app, userAgent, lastSeenAt: new Date() },
      create: { userId, app, token, userAgent },
    });
  }

  async unregisterDevice(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  async inbox(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, channel: 'IN_APP' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, templateKey: true, payload: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } }),
    ]);

    return {
      unread,
      items: items.map(({ templateKey, payload, ...rest }) => ({
        kind: templateKey,
        ...(payload as object),
        ...rest,
      })),
    };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, channel: 'IN_APP', readAt: null },
      data: { readAt: new Date() },
    });
  }
}
