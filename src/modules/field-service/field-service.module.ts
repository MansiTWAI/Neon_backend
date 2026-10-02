import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FieldServiceController } from './field-service.controller';
import { FieldServiceService } from './field-service.service';

@Module({
  imports: [NotificationsModule],
  controllers: [FieldServiceController],
  providers: [FieldServiceService],
  exports: [FieldServiceService],
})
export class FieldServiceModule {}
