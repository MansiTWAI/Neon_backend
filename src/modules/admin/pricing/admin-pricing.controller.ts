import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import {
  AddonsDto,
  addonsSchema,
  CouponDto,
  couponSchema,
  PricingRulesDto,
  pricingRulesSchema,
  RateEntriesDto,
  rateEntriesSchema,
  ZoneDto,
  zonePincodesSchema,
  ZonePincodesDto,
  zoneSchema,
} from './admin-pricing.dto';
import { AdminPricingService } from './admin-pricing.service';

const id = new ParseUUIDPipe();

@Controller('admin/pricing')
@Authenticated(['admin'])
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get('rate-cards')
  @RequirePermissions('pricing.read')
  rateCards() {
    return this.pricing.rateCards();
  }

  @Get('rate-cards/:id')
  @RequirePermissions('pricing.read')
  rateCard(@Param('id', id) versionId: string) {
    return this.pricing.rateCard(versionId);
  }

  @Post('rate-cards')
  @RequirePermissions('pricing.write')
  createDraft(@CurrentAuth() auth: AccessClaims, @Meta() meta: RequestMeta) {
    return this.pricing.createDraft(auth.sub, meta);
  }

  @Put('rate-cards/:id/entries')
  @RequirePermissions('pricing.write')
  saveEntries(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) versionId: string,
    @Body(new ZodValidationPipe(rateEntriesSchema)) dto: RateEntriesDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveEntries(auth.sub, versionId, dto, meta);
  }

  @Post('rate-cards/:id/publish')
  @HttpCode(200)
  @RequirePermissions('pricing.publish')
  publish(@CurrentAuth() auth: AccessClaims, @Param('id', id) versionId: string, @Meta() meta: RequestMeta) {
    return this.pricing.publish(auth.sub, versionId, meta);
  }

  @Delete('rate-cards/:id')
  @HttpCode(204)
  @RequirePermissions('pricing.write')
  discard(@CurrentAuth() auth: AccessClaims, @Param('id', id) versionId: string, @Meta() meta: RequestMeta) {
    return this.pricing.discardDraft(auth.sub, versionId, meta);
  }

  @Get('rules')
  @RequirePermissions('pricing.read')
  rules() {
    return this.pricing.rules();
  }

  /** Rules and extras take effect immediately, so changing them needs the publish permission. */
  @Put('rules')
  @RequirePermissions('pricing.publish')
  saveRules(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(pricingRulesSchema)) dto: PricingRulesDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveRules(auth.sub, dto, meta);
  }

  @Put('addons')
  @RequirePermissions('pricing.publish')
  saveAddons(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(addonsSchema)) dto: AddonsDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveAddons(auth.sub, dto, meta);
  }

  @Get('zones')
  @RequirePermissions('pricing.read')
  zones() {
    return this.pricing.zones();
  }

  @Post('zones')
  @RequirePermissions('pricing.write')
  createZone(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(zoneSchema)) dto: ZoneDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveZone(auth.sub, null, dto, meta);
  }

  @Put('zones/:id')
  @RequirePermissions('pricing.write')
  updateZone(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) zoneId: string,
    @Body(new ZodValidationPipe(zoneSchema)) dto: ZoneDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveZone(auth.sub, zoneId, dto, meta);
  }

  @Put('zones/:id/pincodes')
  @RequirePermissions('pricing.write')
  savePincodes(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) zoneId: string,
    @Body(new ZodValidationPipe(zonePincodesSchema)) dto: ZonePincodesDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.savePincodes(auth.sub, zoneId, dto, meta);
  }

  @Get('coupons')
  @RequirePermissions('pricing.read')
  coupons() {
    return this.pricing.coupons();
  }

  @Post('coupons')
  @RequirePermissions('pricing.write')
  createCoupon(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(couponSchema)) dto: CouponDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveCoupon(auth.sub, null, dto, meta);
  }

  @Put('coupons/:id')
  @RequirePermissions('pricing.write')
  updateCoupon(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) couponId: string,
    @Body(new ZodValidationPipe(couponSchema)) dto: CouponDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.pricing.saveCoupon(auth.sub, couponId, dto, meta);
  }
}
