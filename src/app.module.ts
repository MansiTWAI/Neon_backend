import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DesignsModule } from './modules/designs/designs.module';
import { FieldServiceModule } from './modules/field-service/field-service.module';
import { HealthModule } from './modules/health/health.module';
import { LeadsModule } from './modules/leads/leads.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PartnerModule } from './modules/partner/partner.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { StaffModule } from './modules/staff/staff.module';
import { StorageModule } from './modules/storage/storage.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DatabaseModule,
    StorageModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    HealthModule,
    PricingModule,
    CatalogModule,
    DesignsModule,
    UploadsModule,
    AddressesModule,
    OrdersModule,
    QuotationsModule,
    LeadsModule,
    AdminModule,
    StaffModule,
    PartnerModule,
    FieldServiceModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
