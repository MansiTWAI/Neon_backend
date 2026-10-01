import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

/** Client address and user agent, for audit records. */
export const Meta = createParamDecorator((_data: unknown, context: ExecutionContext): RequestMeta => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
});
