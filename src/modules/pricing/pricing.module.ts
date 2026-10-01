import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

@Module({
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingService, PricingRepository],
})
export class PricingModule {}
