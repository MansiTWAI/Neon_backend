import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { Env } from '../../config/env';
import { AccessClaims } from './auth.types';
import { TokenService } from './token.service';

const config = { get: () => 'x'.repeat(48) } as unknown as ConfigService<Env, true>;
const tokens = new TokenService(config);

const claims: AccessClaims = {
  sub: '0192a1b2-0000-7000-8000-000000000001',
  aud: 'admin',
  sid: '0192a1b2-0000-7000-8000-000000000002',
  perms: ['orders.read'],
  mfa: true,
};

describe('TokenService', () => {
  it('round-trips access claims', async () => {
    const token = await tokens.signAccess(claims);
    await expect(tokens.verifyAccess(token, ['admin'])).resolves.toMatchObject(claims);
  });

  it('rejects a token issued for another app', async () => {
    const token = await tokens.signAccess({ ...claims, aud: 'customer' });
    await expect(tokens.verifyAccess(token, ['admin'])).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not accept a sign-in challenge as an access token', async () => {
    const challenge = await tokens.signChallenge(
      { sub: claims.sub, aud: 'admin', purpose: 'second-factor' },
      60,
    );
    await expect(tokens.verifyAccess(challenge, ['admin'])).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('checks the challenge purpose', async () => {
    const challenge = await tokens.signChallenge(
      { sub: claims.sub, aud: 'admin', purpose: 'second-factor' },
      60,
    );
    await expect(tokens.verifyChallenge(challenge, 'admin', 'totp-setup')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(tokens.verifyChallenge(challenge, 'admin', 'second-factor')).resolves.toMatchObject({
      sub: claims.sub,
    });
  });

  it('rejects tokens signed with another secret', async () => {
    const other = new TokenService({ get: () => 'y'.repeat(48) } as unknown as ConfigService<Env, true>);
    const token = await other.signAccess(claims);
    await expect(tokens.verifyAccess(token, ['admin'])).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
