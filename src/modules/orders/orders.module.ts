import { Module } from '@nestjs/common';
import { DesignsModule } from '../designs/designs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [DesignsModule, PricingModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [CheckoutService, OrdersService],
})
export class OrdersModule {}
