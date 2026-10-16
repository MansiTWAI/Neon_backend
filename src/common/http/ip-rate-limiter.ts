import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Counts attempts per client address in memory, for endpoints where a stored count would be
 * overkill (registration, password sign-in). The API runs as one instance, so memory is shared by
 * every request; a restart only forgets recent attempts, which the account lockout still covers.
 */
export class IpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly title = 'Too many attempts. Try again in a few minutes.',
  ) {}

  /** Records an attempt from `key`, or throws 429 once the window is full. */
  take(key: string | undefined, now = Date.now()) {
    const id = key ?? 'unknown';
    const recent = (this.hits.get(id) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(id, recent);
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          title: this.title,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000)),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(id, recent);
    if (this.hits.size > 10_000) this.sweep(now);
  }

  private sweep(now: number) {
    for (const [id, times] of this.hits) {
      if (!times.some((at) => at > now - this.windowMs)) this.hits.delete(id);
    }
  }
}
