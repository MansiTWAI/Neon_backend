import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderWorkflowModule } from '../order-workflow/order-workflow.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './razorpay.gateway';

@Module({
  imports: [NotificationsModule, OrderWorkflowModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayGateway],
  exports: [RazorpayGateway],
})
export class PaymentsModule {}
