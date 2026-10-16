import { Module } from '@nestjs/common';
import { AdminClaimsController, PartnerClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  controllers: [PartnerClaimsController, AdminClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
