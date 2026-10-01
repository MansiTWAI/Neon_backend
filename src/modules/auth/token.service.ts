import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { Env } from '../../config/env';
import { AccessClaims, ACCESS_TTL_SECONDS, Audience } from './auth.types';

const ISSUER = 'neon-adda';

type ChallengePurpose = 'second-factor' | 'totp-setup';

interface ChallengeClaims {
  sub: string;
  aud: Audience;
  purpose: ChallengePurpose;
  /** Encrypted TOTP secret, only present on setup challenges. */
  sealed?: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(config.get('JWT_SECRET', { infer: true }));
  }

  signAccess(claims: AccessClaims): Promise<string> {
    const { sub, aud, ...rest } = claims;
    return new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string, audiences: readonly Audience[]): Promise<AccessClaims> {
    const payload = await this.verify(token, audiences);
    if ('purpose' in payload) throw this.unauthorized();
    return {
      sub: payload.sub!,
      aud: payload.aud as Audience,
      sid: payload.sid as string,
      perms: (payload.perms as string[]) ?? [],
      fid: payload.fid as string | undefined,
      tid: payload.tid as string | undefined,
      mfa: Boolean(payload.mfa),
    };
  }

  /** Short-lived token bridging the password step and the second-factor step of a sign-in. */
  signChallenge(claims: ChallengeClaims, ttlSeconds: number): Promise<string> {
    const { sub, aud, ...rest } = claims;
    return new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyChallenge(
    token: string,
    audience: Audience,
    purpose: ChallengePurpose,
  ): Promise<ChallengeClaims> {
    const payload = await this.verify(token, [audience]);
    if (payload.purpose !== purpose) throw this.unauthorized('CHALLENGE_INVALID', 'Please sign in again');
    return { sub: payload.sub!, aud: audience, purpose, sealed: payload.sealed as string | undefined };
  }

  private async verify(token: string, audiences: readonly Audience[]): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: [...audiences] });
      return payload;
    } catch (error) {
      if (error instanceof errors.JWTExpired)
        throw this.unauthorized('TOKEN_EXPIRED', 'Your session has expired');
      throw this.unauthorized();
    }
  }

  private unauthorized(code = 'UNAUTHENTICATED', title = 'Please sign in') {
    return new UnauthorizedException({ code, title });
  }
}
