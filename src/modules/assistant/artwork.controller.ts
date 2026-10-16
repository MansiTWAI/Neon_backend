import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { ARTWORK_ASPECTS, ARTWORK_STYLES, ArtworkService } from './artwork.service';

export const createSchema = z.object({
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

export const backdropSchema = z.object({
  prompt: z.string().trim().min(3, 'Describe the room or wall').max(300, 'Keep it under 300 characters'),
  aspect: z.enum(ARTWORK_ASPECTS).default('landscape'),
});

/**
 * Signed-in customers turn a description into a personalised design, a few a day each, so the free
 * AI allowance is shared fairly. The status is public so the page knows whether to offer it.
 */
@Controller('artwork')
export class ArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  @Get('status')
  status() {
    return { enabled: this.artwork.enabled, perCustomerDaily: this.artwork.customerLimit };
  }

  /** Starts a picture and answers at once with the job to poll; pictures take 20 to 60 seconds. */
  @Post()
  @HttpCode(202)
  @Authenticated(['customer'])
  create(
    @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>,
    @CurrentAuth() auth: AccessClaims,
  ) {
    return this.artwork.start(dto, auth.sub);
  }

  /**
   * Starts an AI wall to preview the customer's sign on. The sign is drawn in their browser; this
   * only paints the room, so it is quicker than a design, and a wall made before comes back free.
   */
  @Post('backdrops')
  @HttpCode(202)
  @Authenticated(['customer'])
  createBackdrop(
    @Body(new ZodValidationPipe(backdropSchema)) dto: z.infer<typeof backdropSchema>,
    @CurrentAuth() auth: AccessClaims,
  ) {
    return this.artwork.startBackdrop(dto, auth.sub);
  }

  @Get('jobs/:id')
  @Authenticated(['customer'])
  job(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AccessClaims) {
    const job = this.artwork.job(id, auth.sub);
    if (!job) {
      throw new NotFoundException({
        code: 'ARTWORK_JOB_NOT_FOUND',
        title: 'That design has expired. Create it again.',
      });
    }
    return job;
  }
}
