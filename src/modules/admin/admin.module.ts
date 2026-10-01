import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { AdminCommissionController } from './commission/admin-commission.controller';
import { AdminCommissionService } from './commission/admin-commission.service';
import { AdminCustomersController } from './customers/admin-customers.controller';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminFranchisesController } from './franchises/admin-franchises.controller';
import { AdminFranchisesService } from './franchises/admin-franchises.service';
import { AdminLeadsController } from './leads/admin-leads.controller';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { OrderWorkflowService } from './orders/order-workflow.service';
import { AdminPricingController } from './pricing/admin-pricing.controller';
import { AdminPricingService } from './pricing/admin-pricing.service';
import { AdminQuotationsController } from './quotations/admin-quotations.controller';
import { AdminQuotationsService } from './quotations/admin-quotations.service';

/** Back-office API for the admin panel. Every route requires an admin session and a permission. */
@Module({
  imports: [NotificationsModule, PricingModule],
  controllers: [
    AdminDashboardController,
    AdminOrdersController,
    AdminQuotationsController,
    AdminCustomersController,
    AdminLeadsController,
    AdminCatalogController,
    AdminPricingController,
    AdminFranchisesController,
    AdminCommissionController,
  ],
  providers: [
    OrderWorkflowService,
    AdminOrdersService,
    AdminQuotationsService,
    AdminPricingService,
    AdminFranchisesService,
    AdminCommissionService,
  ],
})
export class AdminModule {}
