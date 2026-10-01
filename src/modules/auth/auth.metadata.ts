import { Audience } from './auth.types';

export const AUDIENCES_KEY = 'auth:audiences';
export const PERMISSIONS_KEY = 'auth:permissions';
export const ALLOW_WITHOUT_2FA_KEY = 'auth:allow-without-2fa';

/** `'route'` takes the audience from the `:audience` path parameter. */
export type AudienceSource = readonly Audience[] | 'route';
