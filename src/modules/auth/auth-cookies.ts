import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Env } from '../../config/env';
import { accessCookie, ACCESS_TTL_SECONDS, Audience, refreshCookie } from './auth.types';

/**
 * Tokens travel in httpOnly cookies so browser JavaScript never sees them. Each app has
 * its own cookie names, so signing in to the admin panel does not sign you in to the shop.
 */
@Injectable()
export class AuthCookies {
  private readonly base: CookieSerializeOptions;

  constructor(config: ConfigService<Env, true>) {
    this.base = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.get('COOKIE_SECURE', { infer: true }),
      domain: config.get('COOKIE_DOMAIN', { infer: true }),
    };
  }

  set(
    reply: FastifyReply,
    audience: Audience,
    accessToken: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ) {
    reply.setCookie(accessCookie(audience), accessToken, { ...this.base, maxAge: ACCESS_TTL_SECONDS });
    reply.setCookie(refreshCookie(audience), refreshToken, { ...this.base, expires: refreshExpiresAt });
  }

  clear(reply: FastifyReply, audience: Audience) {
    reply.clearCookie(accessCookie(audience), this.base);
    reply.clearCookie(refreshCookie(audience), this.base);
  }

  refreshToken(request: FastifyRequest, audience: Audience): string | undefined {
    return request.cookies[refreshCookie(audience)];
  }
}
