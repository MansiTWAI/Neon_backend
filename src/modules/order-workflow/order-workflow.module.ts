import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderWorkflowService } from './order-workflow.service';

@Module({
  imports: [NotificationsModule],
  providers: [OrderWorkflowService],
  exports: [OrderWorkflowService],
})
export class OrderWorkflowModule {}
