import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import {
  AcceptQuoteDto,
  acceptQuoteSchema,
  QuoteResponseDto,
  quoteResponseSchema,
  RequestQuoteDto,
  requestQuoteSchema,
} from './quotations.dto';
import { QuotationsService } from './quotations.service';

@Controller('quotations')
@Authenticated(['customer'])
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Post()
  request(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(requestQuoteSchema)) dto: RequestQuoteDto,
  ) {
    return this.quotations.request(auth.sub, dto);
  }

  @Get()
  list(@CurrentAuth() auth: AccessClaims) {
    return this.quotations.list(auth.sub);
  }

  @Get(':id')
  detail(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.detail(auth.sub, id);
  }

  @Post(':id/respond')
  @HttpCode(200)
  respond(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(quoteResponseSchema)) dto: QuoteResponseDto,
  ) {
    return this.quotations.respond(auth.sub, id, dto);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(acceptQuoteSchema)) dto: AcceptQuoteDto,
  ) {
    return this.quotations.accept(auth.sub, id, dto);
  }
}
