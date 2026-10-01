import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { ALLOW_WITHOUT_2FA_KEY, AUDIENCES_KEY, AudienceSource, PERMISSIONS_KEY } from './auth.metadata';
import { AccessClaims } from './auth.types';

export function Authenticated(audiences: AudienceSource) {
  return applyDecorators(SetMetadata(AUDIENCES_KEY, audiences), UseGuards(AuthGuard));
}

export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Lets an admin who still has to set up two-factor authentication reach this route. */
export const AllowWithoutTwoFactor = () => SetMetadata(ALLOW_WITHOUT_2FA_KEY, true);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessClaims => context.switchToHttp().getRequest().auth,
);
