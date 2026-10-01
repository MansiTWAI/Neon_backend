import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { numericCode, safeEqual, sha256 } from '../../common/security/crypto';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { Audience, toDbAudience } from './auth.types';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 30_000;
const SEND_WINDOW_MS = 15 * 60_000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

export interface OtpDispatch {
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Only while WhatsApp is not connected, so sign-in works before the Meta account is set up. */
  previewCode?: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * @param deliver false when the number cannot sign in to this app. The caller still gets a
   * normal response, so the endpoint does not reveal which numbers are registered.
   */
  async send(
    phone: string,
    audience: Audience,
    ip: string | undefined,
    deliver = true,
  ): Promise<OtpDispatch> {
    const recent = await this.prisma.otpChallenge.findMany({
      where: {
        phone,
        audience: toDbAudience(audience),
        createdAt: { gte: new Date(Date.now() - SEND_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const lastSentAgo = recent[0] ? Date.now() - recent[0].createdAt.getTime() : Infinity;
    if (lastSentAgo < RESEND_AFTER_MS) {
      throw this.tooMany('Please wait before asking for another code', RESEND_AFTER_MS - lastSentAgo);
    }
    if (recent.length >= MAX_SENDS_PER_WINDOW) {
      const oldest = recent[recent.length - 1]!.createdAt.getTime();
      throw this.tooMany('Too many codes requested. Try again later.', oldest + SEND_WINDOW_MS - Date.now());
    }

    const code = numericCode(CODE_LENGTH);
    await this.prisma.otpChallenge.create({
      data: {
        phone,
        audience: toDbAudience(audience),
        codeHash: sha256(`${phone}:${code}`),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ip,
      },
    });
    if (deliver) await this.whatsapp.sendOtp(phone, code);

    return {
      expiresInSeconds: CODE_TTL_MS / 1000,
      resendInSeconds: RESEND_AFTER_MS / 1000,
      previewCode: deliver && this.whatsapp.inPreview ? code : undefined,
    };
  }

  /** Consumes the latest outstanding code for the number, or throws. */
  async verify(phone: string, audience: Audience, code: string): Promise<void> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, audience: toDbAudience(audience), consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        title: 'This code has expired. Request a new one.',
      });
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw this.tooMany(
        'Too many wrong attempts. Request a new code.',
        challenge.expiresAt.getTime() - Date.now(),
      );
    }

    if (!safeEqual(challenge.codeHash, sha256(`${phone}:${code}`))) {
      const { attempts } = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        code: 'OTP_INVALID',
        title: 'That code is not right',
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
      });
    }

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException({ code: 'OTP_EXPIRED', title: 'This code has already been used' });
    }
  }

  private tooMany(title: string, retryAfterMs: number) {
    return new HttpException(
      { code: 'OTP_RATE_LIMITED', title, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
