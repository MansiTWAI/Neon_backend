import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiImageModel, GeminiSvgModel, ImageUnavailable, MIN_SHAPES, retryAfterMs } from './image-models';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const drawing = (shapes: number) =>
  `<svg viewBox="0 0 10 10">${'<circle cx="5" cy="5" r="4" fill="#f00"/>'.repeat(shapes)}</svg>`;
const geminiText = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const quotaError = (retry: string) =>
  new Response(
    JSON.stringify({ error: { code: 429, message: `Quota exceeded, limit: 20. Please retry in ${retry}.` } }),
    { status: 429 },
  );

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: (Response | Error)[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('GeminiImageModel', () => {
  it('returns the picture Gemini sends back', async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } },
          ],
        }),
      ),
    );
    const image = await new GeminiImageModel('key', ['gemini-2.5-flash-image']).generate({
      prompt: 'roses',
      aspect: 'square',
      seed: 1,
    });
    expect(image.type).toBe('image/png');
    expect(image.body.equals(PNG)).toBe(true);
  });

  it('rests for an hour on a free key with no image quota', async () => {
    stubFetch(new Response('{"error":{"message":"Quota exceeded, limit: 0"}}', { status: 429 }));
    const error = await new GeminiImageModel('key', ['gemini-2.5-flash-image'])
      .generate({ prompt: 'roses', aspect: 'square', seed: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageUnavailable);
    expect((error as ImageUnavailable).restMs).toBe(3600_000);
  });
});

describe('GeminiSvgModel', () => {
  it('moves to the next model when one is out of quota, and skips it next time', async () => {
    const fetch = stubFetch(
      quotaError('2h5m'),
      geminiText(drawing(MIN_SHAPES)),
      geminiText(drawing(MIN_SHAPES)),
    );
    const model = new GeminiSvgModel('key', ['strong', 'backup']);
    const first = await model.generate({
      prompt: 'roses',
      aspect: 'square',
      seed: 1,
      subjects: ['red roses'],
    });
    expect(first.type).toBe('image/svg+xml');
    expect(first.model).toBe('backup');
    expect(first.body.toString()).toContain('width="1024"');
    // The drawing instructions name the subjects the picture must show.
    const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body)) as {
      systemInstruction: { parts: { text: string }[] };
    };
    expect(request.systemInstruction.parts[0]!.text).toContain('- red roses');

    await model.generate({ prompt: 'hearts', aspect: 'portrait', seed: 2 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]![0]).toContain('/backup:');
  });

  it('refuses a drawing too sparse to match the request', async () => {
    stubFetch(geminiText(drawing(MIN_SHAPES - 1)));
    await expect(
      new GeminiSvgModel('key', ['only']).generate({ prompt: 'roses', aspect: 'square', seed: 1 }),
    ).rejects.toThrow('too sparse');
  });

  it('tries the next model after a timeout', async () => {
    stubFetch(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      geminiText(drawing(MIN_SHAPES)),
    );
    const image = await new GeminiSvgModel('key', ['slow', 'quick']).generate({
      prompt: 'x',
      aspect: 'square',
      seed: 1,
    });
    expect(image.model).toBe('quick');
  });

  it('reports a used-up allowance when every model is out of quota', async () => {
    stubFetch(quotaError('1h'), quotaError('30m'));
    const error = await new GeminiSvgModel('key', ['a', 'b'])
      .generate({ prompt: 'x', aspect: 'square', seed: 1 })
      .catch((e: unknown) => e);
    expect((error as ImageUnavailable).quota).toBe(true);
  });
});

describe('retryAfterMs', () => {
  it('reads the wait from a quota error', () => {
    expect(retryAfterMs('Please retry in 14h11m27s.')).toBe((14 * 3600 + 11 * 60 + 27) * 1000);
    expect(retryAfterMs('Please retry in 37.5s.')).toBe(37_500);
    expect(retryAfterMs('try later')).toBe(60_000);
  });
});
