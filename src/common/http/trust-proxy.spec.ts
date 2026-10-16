import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { trustedProxyHops } from './trust-proxy';

/** What the API would see as the client address, behind `hops` proxies. */
async function clientIp(hops: number, forwardedFor: string, peer = '10.0.0.2') {
  const app = Fastify({ trustProxy: hops });
  app.get('/ip', (request) => ({ ip: request.ip }));
  const res = await app.inject({
    url: '/ip',
    remoteAddress: peer,
    headers: { 'x-forwarded-for': forwardedFor },
  });
  await app.close();
  return (res.json() as { ip: string }).ip;
}

describe('the client address behind a proxy', () => {
  it('ignores an address the visitor wrote into X-Forwarded-For themselves', async () => {
    // The visitor sends "1.2.3.4"; Render's proxy appends the real address it saw.
    expect(await clientIp(trustedProxyHops('1'), '1.2.3.4, 49.36.10.20')).toBe('49.36.10.20');
  });

  it('defaults to one proxy, and falls back to one for nonsense', () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops('two')).toBe(1);
    expect(trustedProxyHops('-1')).toBe(1);
    expect(trustedProxyHops('2')).toBe(2);
  });

  it('can be told there is no proxy at all', async () => {
    expect(await clientIp(trustedProxyHops('0'), '1.2.3.4', '49.36.10.20')).toBe('49.36.10.20');
  });
});
