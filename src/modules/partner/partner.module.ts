import { Module } from '@nestjs/common';
import { PartnerController } from './partner.controller';

@Module({ controllers: [PartnerController] })
export class PartnerModule {}
