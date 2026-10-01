import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import {
  AdminQuotationsService,
  QuoteListQuery,
  quoteListSchema,
  SaveQuoteDto,
  saveQuoteSchema,
} from './admin-quotations.service';

const declineSchema = z.object({ reason: z.string().trim().min(5, 'Tell the customer why').max(500) });

@Controller('admin/quotations')
@Authenticated(['admin'])
export class AdminQuotationsController {
  constructor(private readonly quotations: AdminQuotationsService) {}

  @Get()
  @RequirePermissions('quotations.read')
  list(@Query(new ZodValidationPipe(quoteListSchema)) query: QuoteListQuery) {
    return this.quotations.list(query);
  }

  @Get(':id')
  @RequirePermissions('quotations.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.detail(id);
  }

  @Put(':id')
  @RequirePermissions('quotations.write')
  save(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveQuoteSchema)) dto: SaveQuoteDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.quotations.save(auth.sub, id, dto, meta);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('quotations.write')
  send(@CurrentAuth() auth: AccessClaims, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.quotations.send(auth.sub, id, meta);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @RequirePermissions('quotations.write')
  decline(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(declineSchema)) { reason }: z.infer<typeof declineSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.quotations.decline(auth.sub, id, reason, meta);
  }
}
