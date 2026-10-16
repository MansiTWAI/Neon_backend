/**
 * How many proxies sit in front of the API and add to X-Forwarded-For (Render has one). Fastify
 * then takes the client address that the nearest trusted proxy recorded, so a visitor cannot pick
 * their own address by sending the header themselves, which would slip past every per-address
 * limit (enquiries, the design assistant, sign-in codes) and fill the audit log with made-up IPs.
 */
export function trustedProxyHops(value: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  const hops = Number(value ?? 1);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 1;
}
