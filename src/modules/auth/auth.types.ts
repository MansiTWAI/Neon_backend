import { AuthAudience } from '@prisma/client';
import { z } from 'zod';

export const AUDIENCES = ['customer', 'admin', 'franchise', 'technician'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const audienceSchema = z.enum(AUDIENCES);

/** Audiences that sign in with a mobile number and a one-time code. */
export const PHONE_AUDIENCES = ['customer', 'technician'] as const satisfies readonly Audience[];
/** Audiences that sign in with an email address and a password. */
export const PASSWORD_AUDIENCES = ['admin', 'franchise'] as const satisfies readonly Audience[];

export const toDbAudience = (audience: Audience) => audience.toUpperCase() as AuthAudience;

export interface AccessClaims {
  sub: string;
  aud: Audience;
  /** Session id, so a single session can be revoked. */
  sid: string;
  perms: string[];
  /** Franchise the user belongs to (franchise audience). */
  fid?: string;
  /** Technician record (technician audience). */
  tid?: string;
  /** Whether this session passed a second factor. */
  mfa: boolean;
}

export const accessCookie = (audience: Audience) => `na_${audience}_at`;
export const refreshCookie = (audience: Audience) => `na_${audience}_rt`;

export const ACCESS_TTL_SECONDS = 15 * 60;

export const REFRESH_TTL_SECONDS: Record<Audience, number> = {
  customer: 30 * 24 * 3600,
  technician: 30 * 24 * 3600,
  admin: 12 * 3600,
  franchise: 12 * 3600,
};
