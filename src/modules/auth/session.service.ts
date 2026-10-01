import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../../common/security/crypto';
import { PrismaService } from '../../database/prisma.service';
import { Audience, REFRESH_TTL_SECONDS, toDbAudience } from './auth.types';

export interface IssuedSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/**
 * Refresh tokens are opaque, stored only as a hash and rotated on every use. Presenting a
 * token that was already rotated means it leaked, so the whole session family is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    audience: Audience,
    client: ClientInfo,
    familyId: string = randomUUID(),
  ): Promise<IssuedSession> {
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS[audience] * 1000);

    return this.prisma.session
      .create({
        data: {
          userId,
          audience: toDbAudience(audience),
          refreshHash: sha256(refreshToken),
          familyId,
          expiresAt,
          ip: client.ip,
          userAgent: client.userAgent?.slice(0, 300),
        },
      })
      .then((session) => ({ sessionId: session.id, userId, refreshToken, expiresAt }));
  }

  async rotate(refreshToken: string, audience: Audience, client: ClientInfo): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({ where: { refreshHash: sha256(refreshToken) } });

    if (!session || session.audience !== toDbAudience(audience)) throw this.expired();

    if (session.revokedAt) {
      this.logger.warn(`Refresh token reuse detected for user ${session.userId}; revoking session family`);
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw this.expired();
    }

    if (session.expiresAt < new Date()) throw this.expired();

    // Conditional update: if two requests race with the same token, only one of them rotates it.
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw this.expired();

    return this.create(session.userId, audience, client, session.familyId);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return Boolean(session && !session.revokedAt && session.expiresAt > new Date());
  }

  private expired() {
    return new UnauthorizedException({
      code: 'SESSION_EXPIRED',
      title: 'Your session has ended. Please sign in again.',
    });
  }
}
