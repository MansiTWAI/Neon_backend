import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ARTWORK_ASPECTS, ARTWORK_STYLES, ArtworkService } from './artwork.service';

const createSchema = z.object({
  prompt: z.string().trim().min(3, 'Describe the design you want').max(600),
  style: z.enum(ARTWORK_STYLES).default('auto'),
  aspect: z.enum(ARTWORK_ASPECTS).default('square'),
  text: z
    .array(z.string().trim().max(40, 'Keep each line under 40 characters'))
    .max(4, 'Up to 4 lines of text')
    .transform((lines) => lines.filter(Boolean))
    .optional(),
  colors: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours must be hex, like #ff3366'))
    .max(3)
    .optional(),
  seed: z.number().int().min(1).max(2_000_000_000).optional(),
});

/** Public: anyone can turn a description into a personalised design. Rate limited per visitor. */
@Controller('artwork')
export class ArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  @Get('status')
  status() {
    return { enabled: this.artwork.enabled };
  }

  @Post()
  @HttpCode(200)
  create(
    @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.artwork.create(dto, meta.ip);
  }
}
