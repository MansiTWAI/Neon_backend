import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CalculatePriceDto, calculatePriceSchema, pincodeSchema } from './pricing.dto';
import { PricingService } from './pricing.service';

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('pricing/rate-card/current')
  currentRateCard() {
    return this.pricing.currentRules();
  }

  @Post('pricing/calculate')
  @HttpCode(200)
  calculate(@Body(new ZodValidationPipe(calculatePriceSchema)) dto: CalculatePriceDto) {
    return this.pricing.calculate(dto);
  }

  @Get('serviceability/:pincode')
  serviceability(@Param('pincode', new ZodValidationPipe(pincodeSchema)) pincode: string) {
    return this.pricing.serviceability(pincode);
  }
}
