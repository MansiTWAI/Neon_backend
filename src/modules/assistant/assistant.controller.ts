import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AssistantService } from './assistant.service';

const suggestSchema = z.object({
  prompt: z.string().trim().min(3, 'Tell us a little about the sign you want').max(500),
});

/** Public: anyone in the studio can ask for a starting design. */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  status() {
    return { enabled: this.assistant.enabled };
  }

  @Post('suggest')
  @HttpCode(200)
  suggest(
    @Body(new ZodValidationPipe(suggestSchema)) dto: z.infer<typeof suggestSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.assistant.suggest(dto.prompt, meta.ip);
  }
}
