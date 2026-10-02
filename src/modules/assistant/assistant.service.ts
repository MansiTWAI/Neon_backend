import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Env } from '../../config/env';
import { CatalogService } from '../catalog/catalog.service';
import { SlidingWindow } from './sliding-window';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const PER_VISITOR_PER_HOUR = 10;
const IST_OFFSET_MS = 5.5 * 3600_000;

type StudioAssets = Awaited<ReturnType<CatalogService['studioAssets']>>;

export interface DesignSuggestion {
  lines: { text: string; colorId: string }[];
  fontFamily: string;
  widthIn: number;
  backboardCode: string;
  addonCodes: string[];
  note: string;
}

/** The shape Claude is asked to fill. Everything is checked against the catalogue afterwards. */
const proposalSchema = z.object({
  lines: z
    .array(z.object({ text: z.string().trim().min(1).max(30), color: z.string() }))
    .min(1)
    .max(3),
  font: z.string(),
  widthInches: z.number(),
  backboard: z.string(),
  extras: z.array(z.string()).max(5).default([]),
  note: z.string().max(300).default(''),
});

/**
 * Turns a customer's description ("pink 'Oh Baby' for a baby shower, about 3 feet") into a
 * starting design for the studio. Claude only chooses from the live catalogue and never sees or
 * sets prices: the studio prices the design the normal way once it is loaded.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly dailyLimit: number;
  private readonly perVisitor = new SlidingWindow(PER_VISITOR_PER_HOUR, 3600_000);
  private day = '';
  private usedToday = 0;

  constructor(
    config: ConfigService<Env, true>,
    private readonly catalog: CatalogService,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('ANTHROPIC_MODEL', { infer: true });
    this.dailyLimit = config.get('ASSISTANT_DAILY_LIMIT', { infer: true });
  }

  get enabled(): boolean {
    return Boolean(this.apiKey) && this.dailyLimit > 0;
  }

  async suggest(prompt: string, visitor: string): Promise<DesignSuggestion> {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_UNAVAILABLE',
        title: 'The design assistant is not switched on',
      });
    }
    this.takeQuota(visitor);

    const assets = await this.catalog.studioAssets();
    const product = assets.products.find((p) => p.type === 'TEXT_NEON');
    if (!product || !assets.fonts.length || !assets.colors.length || !assets.backboards.length) {
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_UNAVAILABLE',
        title: 'The studio is not set up yet',
      });
    }

    const proposal = await this.ask(prompt, assets, product);
    return this.toSuggestion(proposal, assets, product);
  }

  private takeQuota(visitor: string) {
    const today = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
    if (this.usedToday >= this.dailyLimit) {
      throw new HttpException(
        {
          code: 'ASSISTANT_BUSY',
          title: 'The design assistant is resting for today. Design it yourself below.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.perVisitor.take(visitor)) {
      throw new HttpException(
        { code: 'ASSISTANT_LIMIT', title: 'That is a lot of ideas for one hour. Try again a little later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.usedToday += 1;
  }

  private async ask(
    prompt: string,
    assets: StudioAssets,
    product: StudioAssets['products'][number],
  ): Promise<z.infer<typeof proposalSchema>> {
    const system = [
      'You help customers of Neon Adda, an Indian custom neon sign shop, start a text neon sign in the design studio.',
      'Read what the customer wants and propose one design using only the options listed. Keep their wording when they give it; otherwise write short, natural lettering (at most 3 lines of up to 30 characters).',
      'Pick colours that match their mood or event, a font that fits the style, and a sensible width in inches.',
      `Width must be between ${product.minWidthIn} and ${product.maxWidthIn} inches. 1 foot is 12 inches. If no size is mentioned, use 24 for one short word and 30 to 36 for longer text.`,
      'Never mention prices, discounts or delivery dates. In "note", tell the customer in one friendly sentence why you chose this look.',
      'If the request is not about a neon sign, still propose a tasteful sign with their words and say so in the note.',
      '',
      `Fonts: ${assets.fonts.map((f) => `${f.family} (${f.styleTag ?? f.name})`).join('; ')}`,
      `Colours: ${assets.colors.map((c) => c.name).join('; ')}`,
      `Backboards: ${assets.backboards.map((b) => `${b.code} (${b.name})`).join('; ')}`,
      `Extras: ${assets.addons.map((a) => `${a.code} (${a.name})`).join('; ') || 'none'}`,
    ].join('\n');

    const tool = {
      name: 'propose_design',
      description: 'Propose one neon sign design for the studio.',
      input_schema: {
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', maxLength: 30 },
                color: { type: 'string', enum: assets.colors.map((c) => c.name) },
              },
              required: ['text', 'color'],
            },
          },
          font: { type: 'string', enum: assets.fonts.map((f) => f.family) },
          widthInches: { type: 'number', minimum: product.minWidthIn, maximum: product.maxWidthIn },
          backboard: { type: 'string', enum: assets.backboards.map((b) => b.code) },
          extras: { type: 'array', items: { type: 'string', enum: assets.addons.map((a) => a.code) } },
          note: { type: 'string', maxLength: 300 },
        },
        required: ['lines', 'font', 'widthInches', 'backboard', 'note'],
      },
    };

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 600,
          system,
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.warn(`Claude request failed: ${(error as Error).message}`);
      throw unavailable();
    }
    if (!response.ok) {
      // The body can echo the prompt, so only the status is logged.
      this.logger.warn(`Claude returned ${response.status}`);
      throw unavailable();
    }

    const body = (await response.json()) as { content?: { type: string; input?: unknown }[] };
    const parsed = proposalSchema.safeParse(body.content?.find((block) => block.type === 'tool_use')?.input);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'ASSISTANT_NO_DESIGN',
        title: 'We could not turn that into a design. Try describing the words, colour and size.',
      });
    }
    return parsed.data;
  }

  /** Maps names back to catalogue ids, dropping anything Claude invented. */
  private toSuggestion(
    proposal: z.infer<typeof proposalSchema>,
    assets: StudioAssets,
    product: StudioAssets['products'][number],
  ): DesignSuggestion {
    const colorByName = new Map(assets.colors.map((c) => [c.name.toLowerCase(), c.id]));
    const fallbackColor = assets.colors[0]!.id;
    const font = assets.fonts.find((f) => f.family === proposal.font) ?? assets.fonts[0]!;
    const backboard = assets.backboards.find((b) => b.code === proposal.backboard) ?? assets.backboards[0]!;
    const addonCodes = new Set(assets.addons.map((a) => a.code));
    const width = Math.round(
      Math.min(product.maxWidthIn, Math.max(product.minWidthIn, proposal.widthInches)),
    );

    return {
      lines: proposal.lines.map((line) => ({
        text: line.text.trim().slice(0, 30),
        colorId: colorByName.get(line.color.toLowerCase()) ?? fallbackColor,
      })),
      fontFamily: font.family,
      widthIn: width,
      backboardCode: backboard.code,
      addonCodes: [...new Set(proposal.extras)].filter((code) => addonCodes.has(code)),
      note: proposal.note,
    };
  }
}

const unavailable = () =>
  new ServiceUnavailableException({
    code: 'ASSISTANT_UNAVAILABLE',
    title: 'The design assistant is busy right now. Try again in a minute.',
  });
