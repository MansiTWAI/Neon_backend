import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import {
  commissionIdsSchema,
  CommissionRuleDto,
  commissionRuleSchema,
  CommissionSettingsDto,
  commissionSettingsSchema,
  createPayoutSchema,
  LedgerQuery,
  ledgerQuerySchema,
  MarkPaidDto,
  markPaidSchema,
} from './admin-commission.dto';
import { AdminCommissionService } from './admin-commission.service';

const id = new ParseUUIDPipe();
const holdSchema = commissionIdsSchema.extend({ hold: z.boolean() });

@Controller('admin/commission')
@Authenticated(['admin'])
export class AdminCommissionController {
  constructor(private readonly commission: AdminCommissionService) {}

  @Get('rules')
  @RequirePermissions('commission.read')
  rules() {
    return this.commission.rules();
  }

  @Post('rules')
  @RequirePermissions('commission.write')
  createRule(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(commissionRuleSchema)) dto: CommissionRuleDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.createRule(auth.sub, dto, meta);
  }

  @Post('rules/:id/end')
  @HttpCode(200)
  @RequirePermissions('commission.write')
  endRule(@CurrentAuth() auth: AccessClaims, @Param('id', id) ruleId: string, @Meta() meta: RequestMeta) {
    return this.commission.endRule(auth.sub, ruleId, meta);
  }

  @Get('ledger')
  @RequirePermissions('commission.read')
  ledger(@Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery) {
    return this.commission.ledger(query);
  }

  @Post('ledger/approve')
  @HttpCode(200)
  @RequirePermissions('commission.approve')
  approve(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(commissionIdsSchema)) { ids }: z.infer<typeof commissionIdsSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.approve(auth.sub, ids, meta);
  }

  @Post('ledger/hold')
  @HttpCode(200)
  @RequirePermissions('commission.approve')
  hold(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(holdSchema)) { ids, hold }: z.infer<typeof holdSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.setHold(auth.sub, ids, hold, meta);
  }

  @Get('payouts')
  @RequirePermissions('commission.read')
  payouts() {
    return this.commission.payouts();
  }

  @Post('payouts')
  @RequirePermissions('payouts.write')
  createPayout(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(createPayoutSchema)) { franchiseId }: z.infer<typeof createPayoutSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.createPayout(auth.sub, franchiseId, meta);
  }

  @Post('payouts/:id/paid')
  @HttpCode(200)
  @RequirePermissions('payouts.write')
  markPaid(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) payoutId: string,
    @Body(new ZodValidationPipe(markPaidSchema)) dto: MarkPaidDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.markPaid(auth.sub, payoutId, dto, meta);
  }

  @Post('payouts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('payouts.write')
  cancelPayout(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) payoutId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.cancelPayout(auth.sub, payoutId, meta);
  }

  @Get('settings')
  @RequirePermissions('commission.read')
  settings() {
    return this.commission.settings();
  }

  @Put('settings')
  @RequirePermissions('commission.write')
  saveSettings(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(commissionSettingsSchema)) dto: CommissionSettingsDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.commission.saveSettings(auth.sub, dto, meta);
  }
}
