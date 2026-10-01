import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { DesignsController } from './designs.controller';
import { DesignsService } from './designs.service';

@Module({
  imports: [PricingModule],
  controllers: [DesignsController],
  providers: [DesignsService],
  exports: [DesignsService],
})
export class DesignsModule {}
