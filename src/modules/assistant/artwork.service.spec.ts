import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import { createSchema } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { ImageModel, ImageUnavailable } from './image-models';

const settings: Partial<Env> = {
  IMAGE_PROVIDERS: ['gemini-svg'],
  GEMINI_MODELS: ['gemini-flash-latest'],
  GEMINI_SVG_MODELS: ['gemini-3-flash-preview'],
  GEMINI_IMAGE_MODELS: [],
  ARTWORK_DAILY_LIMIT: 3,
};
const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;

/** No language model is configured, so simple rules read the prompt; the painter is a stand-in. */
function serviceWith(painter: ImageModel) {
  const service = new ArtworkService(config);
  Object.assign(service, { painters: [painter] });
  return service;
}

async function settle(service: ArtworkService, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = service.job(id);
    if (job && job.status !== 'pending') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job never finished');
}

const request = { prompt: 'Rahul ❤️ Priya with red roses', style: 'auto', aspect: 'square' } as const;

describe('ArtworkService', () => {
  it('makes the picture as a job and keeps the exact words for the overlay', async () => {
    const generate = vi.fn(async () => ({
      body: Buffer.from('<svg/>'),
      type: 'image/svg+xml' as const,
      model: 'gemini-3-flash-preview',
    }));
    const service = serviceWith({ name: 'gemini-svg', generate });
    const { id } = service.start(request, '1.1.1.1');
    expect(service.job(id)).toEqual({ status: 'pending' });

    const job = await settle(service, id);
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

  it('turns a used-up allowance into a clear 429', async () => {
    const service = serviceWith({
      name: 'gemini-svg',
      generate: () => Promise.reject(new ImageUnavailable('out', 0, true)),
    });
    const job = await settle(service, service.start(request, 'a').id);
    expect(job).toMatchObject({ status: 'failed', error: { status: 429, code: 'ARTWORK_QUOTA' } });
  });

  it('turns any other failure into a 503 the page can show', async () => {
    const service = serviceWith({
      name: 'gemini-svg',
      generate: () => Promise.reject(new ImageUnavailable('down')),
    });
    const job = await settle(service, service.start(request, 'a').id);
    expect(job).toMatchObject({ status: 'failed', error: { status: 503, code: 'ARTWORK_FAILED' } });
  });

  it('enforces the daily limit before starting', () => {
    const service = serviceWith({ name: 'slow', generate: () => new Promise(() => undefined) });
    for (let i = 0; i < 3; i++) service.start(request, `visitor-${i}`);
    expect(() => service.start(request, 'visitor-9')).toThrow(HttpException);
  });

  it('knows nothing of a job it never started', () => {
    expect(serviceWith({ name: 'x', generate: vi.fn() }).job('unknown')).toBeNull();
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
