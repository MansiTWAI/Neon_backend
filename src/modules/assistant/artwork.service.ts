import { NEON_FONT_FAMILIES } from '@neon-adda/shared';
import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { DesignModel, ModelUnavailable } from './design-models';
import {
  Aspect,
  CloudflareModel,
  GeminiImageModel,
  GeminiSvgModel,
  ImageModel,
  ImageUnavailable,
  PollinationsModel,
} from './image-models';
import { languageModelFrom } from './language-model';

export const ARTWORK_STYLES = [
  'auto',
  'neon',
  'romantic',
  'realistic',
  '3d',
  'anime',
  'cartoon',
  'minimalist',
  'festive',
  'luxury',
  'watercolor',
] as const;
export type ArtworkStyle = (typeof ARTWORK_STYLES)[number];

export const ARTWORK_ASPECTS = ['square', 'portrait', 'landscape'] as const;

/** What the scene should look like in each style. The image model never draws the words. */
const STYLE_HINTS: Record<Exclude<ArtworkStyle, 'auto'>, string> = {
  neon: 'glowing LED neon tube art on a dark textured wall, vivid light bloom, night atmosphere',
  romantic: 'soft romantic mood, warm bokeh lights, roses and hearts, dreamy pastel glow',
  realistic: 'photorealistic, natural lighting, high detail, shallow depth of field',
  '3d': 'polished 3D render, soft studio lighting, glossy materials, octane render look',
  anime: 'anime illustration, vibrant cel shading, clean line art, expressive colours',
  cartoon: 'playful cartoon illustration, bold outlines, flat cheerful colours',
  minimalist:
    'minimalist composition with a bold, clear focal subject, clean simple shapes, a limited palette',
  festive: 'festive celebration, confetti, balloons, sparkling fairy lights, joyful colours',
  luxury: 'luxury aesthetic, gold foil accents, marble and velvet textures, elegant florals',
  watercolor: 'delicate watercolour painting, soft washes, paper texture, hand-painted florals',
};

const STYLE_FONTS: Record<Exclude<ArtworkStyle, 'auto'>, string> = {
  neon: 'Tilt Neon',
  romantic: 'Great Vibes',
  realistic: 'Righteous',
  '3d': 'Bungee',
  anime: 'Righteous',
  cartoon: 'Lobster',
  minimalist: 'Tilt Neon',
  festive: 'Pacifico',
  luxury: 'Great Vibes',
  watercolor: 'Dancing Script',
};

const FONTS = NEON_FONT_FAMILIES.map((family) => family.split(':')[0]!);
const HEX = /^#[0-9a-f]{6}$/i;
const IST_OFFSET_MS = 5.5 * 3600_000;

export interface ArtworkRequest {
  prompt: string;
  style: ArtworkStyle;
  aspect: Aspect;
  /** Exact words to write on the design, one line each. Overrides what the planner reads. */
  text?: string[];
  colors?: string[];
  seed?: number;
}

export interface ArtworkOverlay {
  lines: { text: string; size: 'lg' | 'md' | 'sm' }[];
  font: string;
  color: string;
  glow: string;
  placement: 'top' | 'center' | 'bottom';
}

export interface Artwork {
  /** The generated picture as a data URL, so the browser can draw on it and download it. */
  image: string;
  title: string;
  overlay: ArtworkOverlay;
  style: Exclude<ArtworkStyle, 'auto'>;
  provider: string;
  /** The model that drew it, when the service has several. */
  model?: string;
  seed: number;
}

/** A picture being made. Pictures take longer than proxies wait, so the browser polls for them. */
export type ArtworkJob =
  | { status: 'pending' }
  | { status: 'done'; artwork: Artwork }
  | { status: 'failed'; error: { status: number; code: string; title: string } };

/** Finished jobs are kept this long for the browser to collect. */
const JOB_TTL_MS = 10 * 60_000;

const planSchema = z.object({
  title: z.string().trim().min(1).max(60),
  style: z.enum(ARTWORK_STYLES).catch('neon'),
  scene: z.string().trim().min(10).max(700),
  subjects: z.array(z.string().trim().min(2).max(120)).max(5).default([]),
  lines: z
    .array(z.object({ text: z.string().trim().min(1).max(40), size: z.enum(['lg', 'md', 'sm']).catch('md') }))
    .max(4)
    .default([]),
  font: z.string(),
  color: z.string().regex(HEX),
  glow: z.string().regex(HEX),
  placement: z.enum(['top', 'center', 'bottom']).catch('center'),
});
type Plan = z.infer<typeof planSchema>;

/**
 * Turns "a birthday poster for Ananya 🎂 in pink and gold" into a picture. A language model reads
 * the request and splits it into a scene to paint (with no lettering) and the exact words to write
 * over it; an image model paints the scene; the browser draws the words, so names are never misspelt.
 */
@Injectable()
export class ArtworkService {
  private readonly logger = new Logger(ArtworkService.name);
  private readonly planner: DesignModel | null;
  private readonly painters: ImageModel[];
  private readonly resting = new Map<string, number>();
  private readonly dailyLimit: number;
  private readonly perCustomer: number;
  private day = '';
  private usedToday = 0;
  private readonly jobs = new Map<string, { owner: string; job: ArtworkJob; expires: number }>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    // Reading a request is easy work: the light model keeps the free daily allowance of the
    // stronger models for drawing.
    this.planner = languageModelFrom(config, [
      'gemini-3.1-flash-lite',
      ...config.get('GEMINI_MODELS', { infer: true }),
    ]);
    const gemini = config.get('GEMINI_API_KEY', { infer: true });
    const cloudflareAccount = config.get('CLOUDFLARE_ACCOUNT_ID', { infer: true });
    const cloudflareToken = config.get('CLOUDFLARE_AI_TOKEN', { infer: true });
    const available: Record<string, () => ImageModel | null> = {
      gemini: () =>
        gemini ? new GeminiImageModel(gemini, config.get('GEMINI_IMAGE_MODELS', { infer: true })) : null,
      'gemini-svg': () =>
        gemini ? new GeminiSvgModel(gemini, config.get('GEMINI_SVG_MODELS', { infer: true })) : null,
      cloudflare: () =>
        cloudflareAccount && cloudflareToken ? new CloudflareModel(cloudflareAccount, cloudflareToken) : null,
      pollinations: () => new PollinationsModel(config.get('POLLINATIONS_API_KEY', { infer: true })),
    };
    this.painters = config
      .get('IMAGE_PROVIDERS', { infer: true })
      .map((name) => available[name]?.() ?? null)
      .filter((model): model is ImageModel => model !== null);
    this.dailyLimit = config.get('ARTWORK_DAILY_LIMIT', { infer: true });
    this.perCustomer = config.get('ARTWORK_PER_CUSTOMER_DAILY', { infer: true });
  }

  /** Pictures each signed-in customer may ask for per day. */
  get customerLimit(): number {
    return this.perCustomer;
  }

  get enabled(): boolean {
    return this.painters.length > 0 && this.dailyLimit > 0;
  }

  /**
   * Checks the limits straight away, then makes the picture in the background. Only the customer
   * who asked can collect it. A picture that cannot be made is not counted against them.
   */
  async start(request: ArtworkRequest, userId: string): Promise<{ id: string; remaining: number }> {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        code: 'ARTWORK_UNAVAILABLE',
        title: 'The AI designer is not switched on',
      });
    }
    const day = this.takeQuota();
    const used = await this.countCustomer(userId, day).catch((error: unknown) => {
      this.usedToday -= 1;
      throw error;
    });
    this.sweepJobs();
    const id = randomUUID();
    const settle = (job: ArtworkJob) =>
      this.jobs.set(id, { owner: userId, job, expires: Date.now() + JOB_TTL_MS });
    settle({ status: 'pending' });
    this.create(request).then(
      (artwork) => settle({ status: 'done', artwork }),
      (error: unknown) => {
        this.usedToday -= 1;
        void this.refundCustomer(userId, day);
        const failure =
          error instanceof HttpException
            ? { status: error.getStatus(), ...(error.getResponse() as { code: string; title: string }) }
            : {
                status: 500,
                code: 'ARTWORK_FAILED',
                title: 'The AI designer could not paint that just now. Try again in a minute.',
              };
        if (!(error instanceof HttpException)) this.logger.error(error);
        settle({ status: 'failed', error: failure });
      },
    );
    return { id, remaining: this.perCustomer - used };
  }

  job(id: string, userId: string): ArtworkJob | null {
    const entry = this.jobs.get(id);
    return entry && entry.owner === userId ? entry.job : null;
  }

  /** Counts one more picture for the customer today, or refuses once they reach the limit. */
  private async countCustomer(userId: string, day: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO artwork_usage ("userId", "day", "count")
      VALUES (${userId}::uuid, ${day}::date, 1)
      ON CONFLICT ("userId", "day") DO UPDATE SET "count" = artwork_usage."count" + 1
      WHERE artwork_usage."count" < ${this.perCustomer}
      RETURNING "count"`;
    if (!rows.length) {
      throw new HttpException(
        {
          code: 'ARTWORK_LIMIT',
          title: `You have made your ${this.perCustomer} AI designs for today. Pick a ready-made background below, or come back tomorrow.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return rows[0]!.count;
  }

  private async refundCustomer(userId: string, day: string) {
    await this.prisma.$executeRaw`
      UPDATE artwork_usage SET "count" = "count" - 1
      WHERE "userId" = ${userId}::uuid AND "day" = ${day}::date AND "count" > 0`.catch((error: unknown) =>
      this.logger.warn(`could not return a picture to the allowance: ${(error as Error).message}`),
    );
  }

  private sweepJobs() {
    const now = Date.now();
    for (const [id, entry] of this.jobs) if (entry.expires < now) this.jobs.delete(id);
  }

  private async create(request: ArtworkRequest): Promise<Artwork> {
    const plan = await this.plan(request);
    const style = plan.style === 'auto' ? 'neon' : plan.style;
    const seed = request.seed ?? randomInt(1, 2_000_000_000);
    const scene = [
      plan.scene,
      STYLE_HINTS[style],
      request.colors?.length ? `Colour palette: ${request.colors.join(', ')}.` : '',
      // The words are drawn on top, so the picture needs a calm area and no lettering of its own.
      `Leave a clear, uncluttered area in the ${plan.placement} for a title to be added later.`,
      'Absolutely no text, letters, words, numbers, signatures or watermarks anywhere in the image.',
    ]
      .filter(Boolean)
      .join(' ');

    const image = await this.paint(scene, request.aspect, seed, plan.subjects);
    return {
      image: `data:${image.type};base64,${image.body.toString('base64')}`,
      title: plan.title,
      overlay: {
        lines: plan.lines,
        font: FONTS.includes(plan.font) ? plan.font : STYLE_FONTS[style],
        color: plan.color,
        glow: plan.glow,
        placement: plan.placement,
      },
      style,
      provider: image.provider,
      model: image.model,
      seed,
    };
  }

  /** Takes one picture from the shop-wide daily allowance and returns today's date in India. */
  private takeQuota(): string {
    const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
    if (this.usedToday >= this.dailyLimit) {
      throw new HttpException(
        {
          code: 'ARTWORK_BUSY',
          title: 'The AI designer has made all its pictures for today. Try again tomorrow.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.usedToday += 1;
    return today;
  }

  /** Asks the language model to read the request; falls back to simple rules when it cannot. */
  private async plan(request: ArtworkRequest): Promise<Plan> {
    const fallback = planByRules(request);
    if (!this.planner) return fallback;

    const system = [
      'You are the art director of Neon Adda, an Indian custom neon sign and personalised design studio.',
      'A customer describes a design. Split it into:',
      '1. "scene": a vivid, specific description for an image model of the artwork ONLY: subject, objects, background, lighting, colours, mood, composition. Never put any words, names, letters or numbers in the scene, and never ask for text, typography or a poster title in it.',
      '   Also list in "subjects" the 1 to 5 things the picture must clearly show, each with its look, e.g. "several large red roses with layered, shaded petals", "glowing red hearts", "a golden 3D birthday cake with candles". Include every object the customer names.',
      '2. "lines": the exact words to write on the design, copied character for character from the customer (names, wishes, dates, emojis). Use "lg" for the main names, "md" for a short phrase, "sm" for a date or detail. Leave it empty if they asked for no words.',
      `3. "font": the typeface that suits the mood, one of: ${FONTS.join(', ')}.`,
      '4. "color" and "glow": hex colours for the lettering and its glow that stand out on the scene and match the requested theme.',
      '5. "placement": where the words sit so they do not cover the main subject.',
      '6. "style": the closest visual style, and "title": a short name for the design.',
      'Keep everything family friendly. If the request is unsafe, describe a tasteful neutral scene instead.',
    ].join('\n');
    const prompt = [
      `Request: ${request.prompt}`,
      request.style !== 'auto' ? `Style chosen by the customer: ${request.style}` : '',
      request.text?.length ? `Words they want written (use exactly these): ${request.text.join(' / ')}` : '',
      request.colors?.length ? `Colours they want: ${request.colors.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 60 },
        style: { type: 'string', enum: ARTWORK_STYLES.filter((s) => s !== 'auto') },
        scene: { type: 'string', maxLength: 700 },
        subjects: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 120 } },
        lines: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', maxLength: 40 },
              size: { type: 'string', enum: ['lg', 'md', 'sm'] },
            },
            required: ['text', 'size'],
          },
        },
        font: { type: 'string', enum: FONTS },
        color: { type: 'string', description: 'Hex colour such as #ff4d8d' },
        glow: { type: 'string', description: 'Hex colour such as #ff1f6b' },
        placement: { type: 'string', enum: ['top', 'center', 'bottom'] },
      },
      required: ['title', 'style', 'scene', 'subjects', 'lines', 'font', 'color', 'glow', 'placement'],
    };

    try {
      const input = await this.planner.propose({
        system,
        prompt,
        schema,
        tool: { name: 'plan_artwork', description: 'Plan one personalised design.' },
        maxTokens: 900,
      });
      const parsed = planSchema.safeParse(input);
      if (!parsed.success) return fallback;
      const plan = parsed.data;
      return {
        ...plan,
        // The customer's own words and choices always win over the model's reading of them.
        lines: request.text?.length ? fallback.lines : plan.lines,
        style: request.style !== 'auto' ? request.style : plan.style,
        color: request.colors?.[0] ?? plan.color,
        glow: request.colors?.[1] ?? request.colors?.[0] ?? plan.glow,
      };
    } catch (error) {
      if (!(error instanceof ModelUnavailable)) throw error;
      this.logger.warn(`planner: ${error.message}`);
      return fallback;
    }
  }

  private async paint(scene: string, aspect: Aspect, seed: number, subjects: string[]) {
    let last: ImageUnavailable | null = null;
    for (const painter of this.painters) {
      if ((this.resting.get(painter.name) ?? 0) > Date.now()) continue;
      try {
        return {
          ...(await painter.generate({ prompt: scene, aspect, seed, subjects })),
          provider: painter.name,
        };
      } catch (error) {
        if (!(error instanceof ImageUnavailable)) throw error;
        this.logger.warn(error.message);
        if (error.restMs) this.resting.set(painter.name, Date.now() + error.restMs);
        last = error;
      }
    }
    this.logger.warn(`no image service answered${last ? '' : ' (all resting)'}`);
    if (last?.quota) {
      throw new HttpException(
        {
          code: 'ARTWORK_QUOTA',
          title:
            "Today's free AI allowance is used up. Pick a ready-made background below, or try again tomorrow.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new ServiceUnavailableException({
      code: 'ARTWORK_FAILED',
      title: 'The AI designer could not paint that just now. Try again in a minute.',
    });
  }
}

const COLOR_WORDS: Record<string, string> = {
  red: '#ff3b4f',
  pink: '#ff5fa2',
  gold: '#ffc94d',
  golden: '#ffc94d',
  yellow: '#ffe14d',
  orange: '#ff8a3d',
  blue: '#4da3ff',
  cyan: '#3df5ff',
  teal: '#2ee6c5',
  green: '#4dff88',
  purple: '#b26bff',
  violet: '#b26bff',
  white: '#fff7e8',
  silver: '#d9e2ec',
};

const STYLE_COLORS: Record<Exclude<ArtworkStyle, 'auto'>, [string, string]> = {
  neon: ['#ff5fa2', '#ff1f8e'],
  romantic: ['#ffd1dc', '#ff3b6b'],
  realistic: ['#ffffff', '#ffb547'],
  '3d': ['#ffffff', '#4da3ff'],
  anime: ['#ffffff', '#ff5fa2'],
  cartoon: ['#ffe14d', '#ff8a3d'],
  minimalist: ['#f5f5f5', '#9aa5b1'],
  festive: ['#ffc94d', '#ff5fa2'],
  luxury: ['#ffd98a', '#c89b3c'],
  watercolor: ['#ffffff', '#b26bff'],
};

const STYLE_WORDS: [RegExp, Exclude<ArtworkStyle, 'auto'>][] = [
  [/\banime\b/i, 'anime'],
  [/\bcartoon\b/i, 'cartoon'],
  [/\b3d\b/i, '3d'],
  [/\b(realistic|photo)/i, 'realistic'],
  [/\bminimal/i, 'minimalist'],
  [/\b(watercolou?r)\b/i, 'watercolor'],
  [/\bneon\b/i, 'neon'],
  // The occasion says more than a colour does: a "pink and gold birthday" is festive.
  [/\b(birthday|diwali|festive|party|celebrat)/i, 'festive'],
  [/\b(romantic|love|anniversary|valentine)|❤/i, 'romantic'],
  [/\b(luxury|elegant|gold)/i, 'luxury'],
];

/** A plain reading of the request, used when no language model is available or it fails. */
export function planByRules(request: ArtworkRequest): Plan {
  const style =
    request.style !== 'auto'
      ? request.style
      : (STYLE_WORDS.find(([pattern]) => pattern.test(request.prompt))?.[1] ?? 'neon');
  const words = request.text?.length ? request.text : wordsIn(request.prompt);
  const named = Object.entries(COLOR_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(request.prompt))
    .map(([, hex]) => hex);
  const colors = request.colors?.length ? request.colors : named;
  let scene = request.prompt;
  for (const word of words) scene = scene.split(word).join(' ');
  return {
    title: (words[0] ?? request.prompt).slice(0, 60),
    style,
    scene: `${scene.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim()}`.padEnd(10, '.'),
    subjects: [],
    lines: words
      .slice(0, 4)
      .map((text, index) => ({ text: text.slice(0, 40), size: index === 0 ? 'lg' : 'md' })),
    font: STYLE_FONTS[style],
    color: colors[0] ?? STYLE_COLORS[style][0],
    glow: colors[1] ?? colors[0] ?? STYLE_COLORS[style][1],
    placement: 'center',
  };
}

const NAME = "\\p{Lu}[\\p{L}'-]*";
const JOINER = '(?:\\s*(?:❤️|❤|♥️|♥|💕|💖|&|\\+)\\s*|\\s+and\\s+)';

/** Finds the words to write: quoted text first, then "Name ❤️ Name", then "for/name Name". */
export function wordsIn(prompt: string): string[] {
  const quoted = [...prompt.matchAll(/["“]([^"“”]{1,40})["”]/g)].map((match) => match[1]!.trim());
  if (quoted.length) return quoted;
  const couple = new RegExp(`(${NAME})${JOINER}(${NAME})`, 'u').exec(prompt);
  if (couple) {
    const heart = /❤️|❤|♥|💕|💖/u.exec(couple[0])?.[0] ?? '❤️';
    return [`${couple[1]} ${heart} ${couple[2]}`];
  }
  const single = new RegExp(
    `\\b(?:for|name|named|called)\\s+(${NAME})(\\s*\\p{Extended_Pictographic}\\uFE0F?)?`,
    'u',
  ).exec(prompt);
  return single ? [`${single[1]}${single[2] ?? ''}`.trim()] : [];
}
