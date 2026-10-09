import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../database/prisma.service';
import { createSchema } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { ImageModel, ImageUnavailable } from './image-models';

const settings: Partial<Env> = {
  IMAGE_PROVIDERS: ['gemini-svg'],
  GEMINI_MODELS: ['gemini-flash-latest'],
  GEMINI_SVG_MODELS: ['gemini-3-flash-preview'],
  GEMINI_IMAGE_MODELS: [],
  ARTWORK_DAILY_LIMIT: 3,
  ARTWORK_PER_CUSTOMER_DAILY: 2,
};
const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;

/**
 * Stands in for the artwork_usage table: the INSERT ... ON CONFLICT counts up to the limit and
 * returns no row once it is reached, the UPDATE gives one back.
 */
function fakeDatabase() {
  const counts = new Map<string, number>();
  const key = (values: unknown[]) => `${String(values[0])}|${String(values[1])}`;
  return {
    counts,
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      const limit = values[2] as number;
      const used = counts.get(key(values)) ?? 0;
      if (used >= limit) return [];
      counts.set(key(values), used + 1);
      return [{ count: used + 1 }];
    }),
    $executeRaw: vi.fn((_sql: TemplateStringsArray, ...values: unknown[]) => {
      counts.set(key(values), Math.max(0, (counts.get(key(values)) ?? 0) - 1));
      return Promise.resolve(1);
    }),
  };
}

/** No language model is configured, so simple rules read the prompt; the painter is a stand-in. */
function serviceWith(painter: ImageModel, database = fakeDatabase()) {
  const service = new ArtworkService(config, database as unknown as PrismaService);
  Object.assign(service, { painters: [painter] });
  return { service, database };
}

async function settle(service: ArtworkService, id: string, user: string) {
  for (let i = 0; i < 100; i++) {
    const job = service.job(id, user);
    if (job && job.status !== 'pending') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job never finished');
}

const request = { prompt: 'Rahul ❤️ Priya with red roses', style: 'auto', aspect: 'square' } as const;
const PRIYA = '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7c';
const RAHUL = '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7d';

describe('ArtworkService', () => {
  it('makes the picture as a job and keeps the exact words for the overlay', async () => {
    const generate = vi.fn(async () => ({
      body: Buffer.from('<svg/>'),
      type: 'image/svg+xml' as const,
      model: 'gemini-3-flash-preview',
    }));
    const { service } = serviceWith({ name: 'gemini-svg', generate });
    const { id, remaining } = await service.start(request, PRIYA);
    expect(remaining).toBe(1);
    expect(service.job(id, PRIYA)).toEqual({ status: 'pending' });

    const job = await settle(service, id, PRIYA);
    expect(job.status).toBe('done');
    if (job.status !== 'done') return;
    expect(job.artwork.image).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
    expect(job.artwork.overlay.lines[0]?.text).toBe('Rahul ❤️ Priya');
    expect(job.artwork.model).toBe('gemini-3-flash-preview');
    // The painter gets the scene without the names, which are drawn on top instead.
    const [painted] = generate.mock.calls[0] as unknown as [{ prompt: string }];
    expect(painted.prompt).not.toContain('Rahul');
    expect(painted.prompt).toContain('roses');
  });

  it("does not show one customer's picture to another", async () => {
    const { service } = serviceWith({
      name: 'gemini-svg',
      generate: async () => ({ body: Buffer.from('<svg/>'), type: 'image/svg+xml' as const }),
    });
    const { id } = await service.start(request, PRIYA);
    await settle(service, id, PRIYA);
    expect(service.job(id, RAHUL)).toBeNull();
  });

  it('stops a customer at their daily limit', async () => {
    const { service } = serviceWith({ name: 'slow', generate: () => new Promise(() => undefined) });
    await service.start(request, PRIYA);
    await service.start(request, PRIYA);
    const refused = await service.start(request, PRIYA).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getResponse()).toMatchObject({ code: 'ARTWORK_LIMIT' });
    // Someone else still has their own allowance.
    await expect(service.start(request, RAHUL)).resolves.toMatchObject({ remaining: 1 });
  });

  it('gives the picture back to the allowance when it cannot be made', async () => {
    const { service, database } = serviceWith({
      name: 'gemini-svg',
      generate: () => Promise.reject(new ImageUnavailable('down')),
    });
    const { id } = await service.start(request, PRIYA);
    const job = await settle(service, id, PRIYA);
    expect(job).toMatchObject({ status: 'failed', error: { status: 503, code: 'ARTWORK_FAILED' } });
    await vi.waitFor(() => expect(database.$executeRaw).toHaveBeenCalled());
    expect([...database.counts.values()]).toEqual([0]);
  });

  it('turns a used-up AI allowance into a clear 429', async () => {
    const { service } = serviceWith({
      name: 'gemini-svg',
      generate: () => Promise.reject(new ImageUnavailable('out', 0, true)),
    });
    const job = await settle(service, (await service.start(request, PRIYA)).id, PRIYA);
    expect(job).toMatchObject({ status: 'failed', error: { status: 429, code: 'ARTWORK_QUOTA' } });
  });

  it('enforces the shop-wide daily limit before counting the customer', async () => {
    const { service, database } = serviceWith({ name: 'slow', generate: () => new Promise(() => undefined) });
    await service.start(request, PRIYA);
    await service.start(request, PRIYA);
    await service.start(request, RAHUL);
    await expect(service.start(request, RAHUL)).rejects.toMatchObject({
      response: { code: 'ARTWORK_BUSY' },
    });
    expect(database.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('knows nothing of a job it never started', () => {
    expect(serviceWith({ name: 'x', generate: vi.fn() }).service.job('unknown', PRIYA)).toBeNull();
  });
});

describe('artwork request validation', () => {
  it('accepts a normal request and fills the defaults', () => {
    expect(createSchema.parse({ prompt: '  Birthday for Ananya 🎂 ', text: ['Ananya 🎂', ''] })).toEqual({
      prompt: 'Birthday for Ananya 🎂',
      style: 'auto',
      aspect: 'square',
      text: ['Ananya 🎂'],
    });
  });

  it.each([
    ['a prompt that is too short', { prompt: 'hi' }],
    ['a prompt that is too long', { prompt: 'x'.repeat(601) }],
    ['an unknown style', { prompt: 'roses', style: 'oil' }],
    ['a line over 40 characters', { prompt: 'roses', text: ['x'.repeat(41)] }],
    ['five lines', { prompt: 'roses', text: ['a', 'b', 'c', 'd', 'e'] }],
    ['a colour that is not hex', { prompt: 'roses', colors: ['red'] }],
  ])('rejects %s', (_, body) => {
    expect(createSchema.safeParse(body).success).toBe(false);
  });
});
