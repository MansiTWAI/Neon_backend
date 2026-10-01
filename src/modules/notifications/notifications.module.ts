import { Module } from '@nestjs/common';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [FirebaseMessagingService, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
