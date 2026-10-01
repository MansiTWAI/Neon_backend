import { Module } from '@nestjs/common';
import { FieldServiceController } from './field-service.controller';

@Module({ controllers: [FieldServiceController] })
export class FieldServiceModule {}
