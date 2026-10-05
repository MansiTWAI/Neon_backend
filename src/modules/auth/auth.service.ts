import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import { Prisma, UserType } from '@prisma/client';
import { randomToken } from '../../common/security/crypto';
import { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  EnableTwoFactorDto,
  PasswordLoginDto,
  SecondFactorDto,
  UpdateProfileDto,
  VerifyOtpDto,
} from './auth.dto';
import { AccessClaims, Audience } from './auth.types';
import { OtpService } from './otp.service';
import { ClientInfo, SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;
const CHALLENGE_TTL_SECONDS = 5 * 60;

const USER_TYPE_FOR: Record<Audience, UserType> = {
  customer: 'CUSTOMER',
  admin: 'STAFF',
  franchise: 'FRANCHISE',
  technician: 'TECHNICIAN',
};

const PORTAL_NAMES: Record<Audience, string> = {
  customer: 'shop',
  admin: 'admin panel',
  franchise: 'partner portal',
  technician: 'technician app',
};

const userWithAccess = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  franchise: { select: { id: true, name: true, code: true, status: true } },
  technician: { select: { id: true, name: true, isActive: true, franchise: { select: { name: true } } } },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userWithAccess }>;

export interface SignedIn {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  profile: ReturnType<AuthService['toProfile']>;
}

export type PasswordLoginResult = SignedIn | { twoFactorRequired: true; challenge: string };

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so response time does not reveal which accounts exist. */
  private decoyHash: Promise<string> = hash(randomToken());

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async requestOtp(audience: Audience, phone: string, ip?: string) {
    const canSignIn =
      audience === 'customer' ||
      (audience === 'technician'
        ? (await this.prisma.technician.count({ where: { phone, isActive: true } })) > 0
        : (await this.franchiseOwnerFor(phone)) !== null);
    // Normally an unknown number gets the same answer as a registered one, so the endpoint does not
    // reveal who is registered. While every number shares the preview code that protects nothing, and
    // a plain answer saves people from waiting for a code that is never coming.
    if (!canSignIn && this.otp.inPreview) {
      throw new UnauthorizedException({
        code: 'NOT_REGISTERED',
        title:
          audience === 'technician'
            ? 'This number is not registered. Ask your franchise to add you as a technician.'
            : 'This number is not registered as a franchise phone. Sign in with your email instead.',
      });
    }
    return this.otp.send(phone, audience, ip, canSignIn);
  }

  async verifyOtp(audience: Audience, { phone, code }: VerifyOtpDto, client: ClientInfo): Promise<SignedIn> {
    await this.otp.verify(phone, audience, code);
    const userId =
      audience === 'customer'
        ? await this.customerFor(phone)
        : audience === 'technician'
          ? await this.technicianUserFor(phone)
          : await this.franchiseOwnerFor(phone);
    if (!userId)
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED', title: 'This number is not registered' });
    return this.signIn(userId, audience, client);
  }

  async passwordLogin(
    audience: Audience,
    { email, password }: PasswordLoginDto,
    client: ClientInfo,
  ): Promise<PasswordLoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const usable =
      user && user.type === USER_TYPE_FOR[audience] && user.status === 'ACTIVE' && user.passwordHash;

    if (!usable) {
      await verify(await this.decoyHash, password);
      throw this.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', title: 'Too many failed attempts. Try again in 15 minutes.' },
        HttpStatus.LOCKED,
      );
    }

    if (!(await verify(user.passwordHash!, password))) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
      throw this.invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    if (user.totpSecret) {
      const challenge = await this.tokens.signChallenge(
        { sub: user.id, aud: audience, purpose: 'second-factor' },
        CHALLENGE_TTL_SECONDS,
      );
      return { twoFactorRequired: true, challenge };
    }
    return this.signIn(user.id, audience, client);
  }

  async verifySecondFactor(
    audience: Audience,
    { challenge, code }: SecondFactorDto,
    client: ClientInfo,
  ): Promise<SignedIn> {
    const { sub } = await this.tokens.verifyChallenge(challenge, audience, 'second-factor');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: sub } });
    if (!user.totpSecret || !this.twoFactor.verify(this.twoFactor.unseal(user.totpSecret), code)) {
      throw new UnauthorizedException({ code: 'TOTP_INVALID', title: 'That code is not right' });
    }
    return this.signIn(user.id, audience, client);
  }

  async startTwoFactorSetup(auth: AccessClaims) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.sub } });
    if (user.totpSecret) {
      throw new ConflictException({
        code: 'TOTP_ALREADY_ENABLED',
        title: 'Two-factor authentication is already on',
      });
    }

    const { secret, uri, qrCodeDataUrl } = await this.twoFactor.createSecret(user.email ?? user.id);
    const setupToken = await this.tokens.signChallenge(
      {
        sub: user.id,
        aud: auth.aud,
        purpose: 'totp-setup',
        sealed: this.twoFactor.seal(secret).toString('base64'),
      },
      10 * 60,
    );
    return { secret, uri, qrCodeDataUrl, setupToken };
  }

  async enableTwoFactor(
    auth: AccessClaims,
    { setupToken, code }: EnableTwoFactorDto,
    client: ClientInfo,
  ): Promise<SignedIn> {
    const { sub, sealed } = await this.tokens.verifyChallenge(setupToken, auth.aud, 'totp-setup');
    if (sub !== auth.sub || !sealed)
      throw new ForbiddenException({ code: 'CHALLENGE_INVALID', title: 'Start the setup again' });

    const sealedSecret = Buffer.from(sealed, 'base64');
    if (!this.twoFactor.verify(this.twoFactor.unseal(sealedSecret), code)) {
      throw new UnauthorizedException({ code: 'TOTP_INVALID', title: 'That code is not right' });
    }

    await this.prisma.user.update({ where: { id: auth.sub }, data: { totpSecret: sealedSecret } });
    // The current session was issued without a second factor; replace it with one that has it.
    await this.sessions.revoke(auth.sid);
    return this.signIn(auth.sub, auth.aud, client, { announce: false });
  }

  async refresh(audience: Audience, refreshToken: string, client: ClientInfo): Promise<SignedIn> {
    const session = await this.sessions.rotate(refreshToken, audience, client);
    const user = await this.loadUser(session.userId, audience);
    return this.tokensFor(user, audience, session.sessionId, session.refreshToken, session.expiresAt);
  }

  async logout(sessionId: string) {
    await this.sessions.revoke(sessionId);
  }

  async profile(auth: AccessClaims) {
    return this.toProfile(await this.loadUser(auth.sub, auth.aud), auth.aud);
  }

  async updateCustomerProfile(auth: AccessClaims, dto: UpdateProfileDto) {
    try {
      await this.prisma.user.update({
        where: { id: auth.sub },
        data: { name: dto.name, email: dto.email ?? null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'EMAIL_TAKEN', title: 'That email is used by another account' });
      }
      throw error;
    }
    return this.profile(auth);
  }

  /**
   * Closes a customer account. Orders and invoices are kept, as tax law requires, but the
   * person's contact details are removed and every session ends.
   */
  async deleteCustomer(auth: AccessClaims) {
    const open = await this.prisma.order.count({
      where: {
        customerId: auth.sub,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'DELIVERED', 'INSTALLED'] },
      },
    });
    if (open) {
      throw new ConflictException({
        code: 'OPEN_ORDERS',
        title: 'You have orders in progress. You can close your account once they are delivered.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.address.deleteMany({ where: { userId: auth.sub } }),
      this.prisma.pushDevice.deleteMany({ where: { userId: auth.sub } }),
      this.prisma.design.updateMany({
        where: { userId: auth.sub },
        data: { isSaved: false, shareSlug: null },
      }),
      this.prisma.session.updateMany({
        where: { userId: auth.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: auth.sub },
        data: { phone: null, email: null, name: null, status: 'DELETED', deletedAt: new Date() },
      }),
    ]);
  }

  private async signIn(
    userId: string,
    audience: Audience,
    client: ClientInfo,
    { announce = true } = {},
  ): Promise<SignedIn> {
    const user = await this.loadUser(userId, audience);
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

    const session = await this.sessions.create(userId, audience, client);
    const signedIn = await this.tokensFor(
      user,
      audience,
      session.sessionId,
      session.refreshToken,
      session.expiresAt,
    );

    if (announce && (audience === 'admin' || audience === 'franchise')) {
      await this.notifications.notify(
        userId,
        {
          kind: 'auth.new-sign-in',
          title: 'New sign-in',
          body: `Your ${PORTAL_NAMES[audience]} account was just signed in${client.ip ? ` from ${client.ip}` : ''}. If this was not you, change your password.`,
        },
        [audience],
      );
    }
    return signedIn;
  }

  private async tokensFor(
    user: UserWithAccess,
    audience: Audience,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<SignedIn> {
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      aud: audience,
      sid: sessionId,
      perms: this.permissionsOf(user),
      fid: audience === 'franchise' ? (user.franchiseId ?? undefined) : undefined,
      tid: audience === 'technician' ? user.technician?.id : undefined,
      // Anyone with two-factor enabled had to pass it to obtain a session.
      mfa: Boolean(user.totpSecret),
    });
    return { accessToken, refreshToken, refreshExpiresAt, profile: this.toProfile(user, audience) };
  }

  /** Loads the user and checks they may still use this app. */
  private async loadUser(userId: string, audience: Audience): Promise<UserWithAccess> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userWithAccess });
    const allowed =
      user &&
      user.status === 'ACTIVE' &&
      user.type === USER_TYPE_FOR[audience] &&
      (audience !== 'franchise' || user.franchise?.status === 'ACTIVE') &&
      (audience !== 'technician' || user.technician?.isActive);

    if (!allowed)
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        title: 'This account cannot sign in here',
      });
    return user;
  }

  toProfile(user: UserWithAccess, audience: Audience) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      roles: user.roles.map(({ role }) => ({ key: role.key, name: role.name })),
      permissions: this.permissionsOf(user),
      twoFactorEnabled: Boolean(user.totpSecret),
      twoFactorSetupRequired:
        audience === 'admin' && !user.totpSecret && this.config.get('REQUIRE_ADMIN_2FA', { infer: true }),
      franchise: user.franchise
        ? { id: user.franchise.id, name: user.franchise.name, code: user.franchise.code }
        : null,
      technician: user.technician
        ? {
            id: user.technician.id,
            name: user.technician.name,
            franchise: user.technician.franchise?.name ?? null,
          }
        : null,
    };
  }

  private permissionsOf(user: UserWithAccess): string[] {
    return [
      ...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key))),
    ].sort();
  }

  private async customerFor(phone: string): Promise<string> {
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, type: 'CUSTOMER' },
      select: { id: true, type: true },
    });
    if (user.type !== 'CUSTOMER')
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED', title: 'Use your work app to sign in' });
    return user.id;
  }

  /** Technicians are registered by their franchise; their login is created on first sign-in. */
  private async technicianUserFor(phone: string): Promise<string> {
    const technician = await this.prisma.technician.findUnique({ where: { phone } });
    if (!technician?.isActive)
      throw new UnauthorizedException({ code: 'ACCOUNT_DISABLED', title: 'This number is not registered' });
    if (technician.userId) return technician.userId;

    const user = await this.prisma.user.create({
      data: { type: 'TECHNICIAN', name: technician.name, technician: { connect: { id: technician.id } } },
    });
    return user.id;
  }

  /**
   * The owner of the franchise whose registered phone this is, if their account is active. Owners who
   * switched on an authenticator app must sign in with their email, so the phone never skips it.
   */
  private async franchiseOwnerFor(phone: string): Promise<string | null> {
    const franchise = await this.prisma.franchise.findFirst({
      where: {
        phone,
        deletedAt: null,
        owner: { type: 'FRANCHISE', status: 'ACTIVE', deletedAt: null, totpSecret: null },
      },
      select: { ownerUserId: true },
    });
    return franchise?.ownerUserId ?? null;
  }

  private invalidCredentials() {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      title: 'Email or password is incorrect',
    });
  }
}
