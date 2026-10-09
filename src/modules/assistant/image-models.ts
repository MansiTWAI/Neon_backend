import { ImageType, sniffImage } from '../storage/storage.service';
import { balanceTags, isWellFormed } from './svg-markup';

/**
 * The services that paint the artwork behind a design. Each takes a scene description that asks
 * for no lettering (names are drawn on top by the browser, where they are always spelled right)
 * and returns the image bytes.
 */

export type Aspect = 'square' | 'portrait' | 'landscape';

export interface ImageRequest {
  prompt: string;
  aspect: Aspect;
  seed: number;
  /** The things the picture must show, e.g. "red roses with shaded petals". */
  subjects?: string[];
}

export interface GeneratedImage {
  body: Buffer;
  type: ImageType | 'image/svg+xml';
  /** The model that made it, where a service has several. */
  model?: string;
}

export interface ImageModel {
  readonly name: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

/**
 * The service could not paint this time. `restMs` is set when the account itself is out of quota
 * or not allowed to generate images, so the service is skipped for that long. Messages never hold
 * the prompt.
 */
export class ImageUnavailable extends Error {
  constructor(
    message: string,
    readonly restMs = 0,
    /** True when the account has used up its allowance, rather than a passing failure. */
    readonly quota = false,
  ) {
    super(message);
  }
}

const HOUR = 3600_000;

const TIMEOUT_MS = 90_000;
/** Per model, so that falling back to the next one still fits in a reasonable wait. */
const SVG_TIMEOUT_MS = 55_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** Gemini's image models ("Nano Banana"). Needs a key on a billed Google AI Studio project. */
export class GeminiImageModel implements ImageModel {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
  ) {}

  async generate({ prompt, aspect }: ImageRequest): Promise<GeneratedImage> {
    let last = new ImageUnavailable('no image model configured');
    for (const model of this.models) {
      const response = await send(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: { square: '1:1', portrait: '3:4', landscape: '4:3' }[aspect] },
            },
          }),
        },
      );
      if (response.ok) {
        const body = (await response.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
        };
        const data = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData
          ?.data;
        if (data) return checked(Buffer.from(data, 'base64'), `gemini ${model}`);
        // Usually a safety refusal: another model will refuse the same prompt.
        throw new ImageUnavailable(`gemini ${model} returned no image`);
      }
      const detail = await response.text().catch(() => '');
      // "limit: 0" is a free-tier key with no image quota; 403 is a key without access.
      const noAccess = response.status === 403 || (response.status === 429 && /limit: 0\b/.test(detail));
      last = new ImageUnavailable(`gemini ${model} returned ${response.status}`, noAccess ? HOUR : 0);
      if (![404, 429, 500, 503].includes(response.status)) break;
    }
    throw last;
  }
}

const POLLINATIONS_SIZES: Record<Aspect, [number, number]> = {
  square: [1024, 1024],
  portrait: [864, 1152],
  landscape: [1152, 864],
};

const VIEWBOXES: Record<Aspect, [number, number]> = {
  square: [1024, 1024],
  portrait: [768, 1024],
  landscape: [1024, 768],
};

/** Fewer shapes than this is a sketch, not artwork: seen when a light model takes over. */
export const MIN_SHAPES = 35;

/**
 * Gemini's text models drawing the artwork as SVG. Works on a free key, where Gemini's image models
 * have no quota: the result is vector illustration rather than a photograph, which suits neon well.
 * Free keys allow only about 20 requests a day per model, so a model that runs out is skipped until
 * its quota resets, and drawings too sparse to match the request are refused rather than shown.
 */
export class GeminiSvgModel implements ImageModel {
  readonly name = 'gemini-svg';
  private readonly resting = new Map<string, number>();

  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
  ) {}

  async generate({ prompt, aspect, subjects = [] }: ImageRequest): Promise<GeneratedImage> {
    const [width, height] = VIEWBOXES[aspect];
    const system = [
      'You are an illustrator who draws in SVG. Reply with ONE complete SVG document and nothing else: no markdown, no explanation.',
      `Start with <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">.`,
      'Draw rich, detailed, beautiful artwork that fills the whole canvas: a layered gradient background, shaded shapes with depth and lighting, radialGradient glows and feGaussianBlur glow filters, about 80 to 250 elements. Follow the requested colours and style closely.',
      subjects.length
        ? `You MUST draw every one of these subjects, large and unmistakable, each built from several shaped paths with gradient shading so it is recognisable at a glance:\n${subjects.map((subject) => `- ${subject}`).join('\n')}`
        : 'Clearly show every subject the brief names.',
      'The main subjects must together cover at least half of the canvas; never a mostly empty canvas or a blank card.',
      'Never use <text>, letters or numbers, <image>, <foreignObject>, scripts, event attributes or links to other files.',
    ].join('\n');

    let last = new ImageUnavailable('no Gemini model configured');
    let outOfQuota = 0;
    for (const model of this.models) {
      if ((this.resting.get(model) ?? 0) > Date.now()) {
        outOfQuota += 1;
        continue;
      }
      let response: Response;
      try {
        response = await send(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 20000, temperature: 1 },
            }),
          },
          SVG_TIMEOUT_MS,
        );
      } catch (error) {
        // A slow model is often just busy: the next one usually answers.
        last = error as ImageUnavailable;
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
        const svg = cleanSvg(text, width, height);
        if (svg && shapeCount(svg) >= MIN_SHAPES) {
          return { body: Buffer.from(svg), type: 'image/svg+xml', model };
        }
        last = new ImageUnavailable(
          `gemini-svg ${model} returned ${svg ? 'too sparse a drawing' : 'no drawing'}`,
        );
        continue;
      }
      const detail = await response.text().catch(() => '');
      if (response.status === 429) {
        outOfQuota += 1;
        this.resting.set(model, Date.now() + retryAfterMs(detail));
      }
      last = new ImageUnavailable(`gemini-svg ${model} returned ${response.status}`);
      if (![404, 429, 500, 503].includes(response.status)) break;
    }
    // Out of quota on some models and refused or failed on the rest: the allowance is the reason.
    if (outOfQuota) {
      throw new ImageUnavailable('gemini-svg: every model is out of quota', 0, true);
    }
    throw last;
  }
}

/** How many drawn shapes an SVG holds. */
export function shapeCount(svg: string): number {
  return svg.match(/<(path|circle|ellipse|rect|polygon|polyline|line)\b/g)?.length ?? 0;
}

/** Reads "Please retry in 14h11m27s" from a quota error; a minute when it says nothing. */
export function retryAfterMs(detail: string): number {
  const match = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(detail);
  if (!match || !(match[1] || match[2] || match[3])) return 60_000;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1000;
}

/**
 * Keeps only the drawing: the outer <svg> element, without scripts, embedded HTML, event handlers
 * or references to anything outside the file, with unclosed tags repaired. Returns null when there
 * is no complete drawing or the markup is still broken, since browsers refuse to draw it.
 */
export function cleanSvg(text: string, width: number, height: number): string | null {
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start < 0 || end < start) return null;
  let svg = text.slice(start, end + 6);
  svg = svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<\/?(script|foreignObject|image|iframe|a)\b[^>]*>/gi, '')
    .replace(/<text[\s\S]*?<\/text\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none')
    .replace(/@import[^;]*;/gi, '');
  // A fixed size so the browser knows how big to draw it.
  svg = svg.replace(/^<svg\b[^>]*>/, (tag) => {
    const rest = tag.replace(/\s(width|height|viewBox|xmlns)\s*=\s*("[^"]*"|'[^']*')/gi, '').slice(4, -1);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${rest}>`;
  });
  svg = balanceTags(svg);
  return svg.length > 200 && svg.length < 600_000 && isWellFormed(svg) ? svg : null;
}

/**
 * Cloudflare Workers AI running FLUX.1 [schnell]. A free Cloudflare account includes a daily
 * allowance of a few hundred images; needs CLOUDFLARE_ACCOUNT_ID and an API token with
 * "Workers AI" permission.
 */
export class CloudflareModel implements ImageModel {
  readonly name = 'cloudflare';

  constructor(
    private readonly accountId: string,
    private readonly token: string,
  ) {}

  async generate({ prompt }: ImageRequest): Promise<GeneratedImage> {
    const response = await send(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        // FLUX schnell on Workers AI refuses any field it does not know, including a seed.
        body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 6 }),
      },
    );
    if (!response.ok) {
      // 401/403: a wrong token. 429: today's free allowance is used up; it renews at midnight UTC.
      if (response.status === 429) {
        throw new ImageUnavailable('cloudflare: daily allowance used up', untilUtcMidnight(), true);
      }
      throw new ImageUnavailable(
        `cloudflare returned ${response.status}`,
        [401, 403].includes(response.status) ? HOUR : 0,
      );
    }
    const body = (await response.json()) as { result?: { image?: string } };
    if (!body.result?.image) throw new ImageUnavailable('cloudflare returned no image');
    return checked(Buffer.from(body.result.image, 'base64'), 'cloudflare');
  }
}

/**
 * Pollinations.ai. Without a key it uses the public endpoint, which only allows a few images per
 * address before asking for payment (402); with POLLINATIONS_API_KEY it uses the keyed endpoint.
 */
export class PollinationsModel implements ImageModel {
  readonly name = 'pollinations';

  constructor(private readonly apiKey: string | undefined) {}

  async generate({ prompt, aspect, seed }: ImageRequest): Promise<GeneratedImage> {
    const [width, height] = POLLINATIONS_SIZES[aspect];
    const params = new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(seed),
      nologo: 'true',
      private: 'true',
      safe: 'true',
    });
    const path = encodeURIComponent(prompt.slice(0, 900));
    const response = this.apiKey
      ? await send(`https://gen.pollinations.ai/image/${path}?model=flux&${params}`, {
          headers: { authorization: `Bearer ${this.apiKey}` },
        })
      : await send(`https://image.pollinations.ai/prompt/${path}?${params}`, {});
    if (!response.ok) {
      const rest = response.status === 401 ? HOUR : [402, 429].includes(response.status) ? HOUR / 6 : 0;
      throw new ImageUnavailable(`pollinations returned ${response.status}`, rest);
    }
    return checked(Buffer.from(await response.arrayBuffer()), 'pollinations');
  }
}

async function send(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ImageUnavailable(`request failed: ${(error as Error).name}`);
  }
}

function checked(body: Buffer, source: string): GeneratedImage {
  const type = sniffImage(body);
  if (!type || body.length > MAX_BYTES)
    throw new ImageUnavailable(`${source} sent something that is not an image`);
  return { body, type };
}

function untilUtcMidnight(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}
