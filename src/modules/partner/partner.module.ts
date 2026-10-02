import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PartnerController],
  providers: [PartnerService],
})
export class PartnerModule {}
