import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Env } from '../../config/env';
import { ALLOW_WITHOUT_2FA_KEY, AUDIENCES_KEY, AudienceSource, PERMISSIONS_KEY } from './auth.metadata';
import { accessCookie, AccessClaims, Audience, audienceSchema } from './auth.types';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

type AuthenticatedRequest = FastifyRequest & { auth?: AccessClaims };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const targets = [context.getHandler(), context.getClass()];

    const audiences = this.resolveAudiences(
      this.reflector.getAllAndOverride<AudienceSource>(AUDIENCES_KEY, targets),
      request,
    );
    const token =
      this.bearerToken(request) ?? audiences.map((aud) => request.cookies[accessCookie(aud)]).find(Boolean);
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Please sign in' });

    const claims = await this.tokens.verifyAccess(token, audiences);
    if (!(await this.sessions.isActive(claims.sid))) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        title: 'Your session has ended. Please sign in again.',
      });
    }

    const allowWithout2fa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_2FA_KEY, targets);
    if (
      claims.aud === 'admin' &&
      !claims.mfa &&
      !allowWithout2fa &&
      this.config.get('REQUIRE_ADMIN_2FA', { infer: true })
    ) {
      throw new ForbiddenException({
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        title: 'Set up two-factor authentication to continue',
      });
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((permission) => !claims.perms.includes(permission));
    if (missing.length) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'You do not have access to this', missing });
    }

    request.auth = claims;
    return true;
  }

  private resolveAudiences(source: AudienceSource, request: FastifyRequest): readonly Audience[] {
    if (source !== 'route') return source;
    const parsed = audienceSchema.safeParse((request.params as Record<string, string>).audience);
    if (!parsed.success)
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Please sign in' });
    return [parsed.data];
  }

  private bearerToken(request: FastifyRequest): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
