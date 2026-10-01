import { Module } from '@nestjs/common';
import { DesignsModule } from '../designs/designs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [DesignsModule, PricingModule, NotificationsModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
})
export class QuotationsModule {}
