import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import { orderNoSchema } from '../../orders/orders.dto';
import {
  CandidatesQuery,
  candidatesQuerySchema,
  CreateTechnicianDto,
  createTechnicianSchema,
  SuspendTechnicianDto,
  suspendTechnicianSchema,
  TechnicianDetailsDto,
  technicianDetailsSchema,
  TechnicianListQuery,
  technicianListSchema,
} from './admin-technicians.dto';
import { AdminTechniciansService } from './admin-technicians.service';

const id = new ParseUUIDPipe();

@Controller('admin/technicians')
@Authenticated(['admin'])
export class AdminTechniciansController {
  constructor(private readonly technicians: AdminTechniciansService) {}

  @Get()
  @RequirePermissions('technicians.read')
  list(@Query(new ZodValidationPipe(technicianListSchema)) query: TechnicianListQuery) {
    return this.technicians.list(query);
  }

  /** Who could take an order's installation, best match first. */
  @Get('candidates/:orderNo')
  @RequirePermissions('technicians.read')
  candidates(
    @Param('orderNo', new ZodValidationPipe(orderNoSchema)) orderNo: string,
    @Query(new ZodValidationPipe(candidatesQuerySchema)) query: CandidatesQuery,
  ) {
    return this.technicians.candidates(orderNo, query);
  }

  @Get(':id')
  @RequirePermissions('technicians.read')
  detail(@Param('id', id) technicianId: string) {
    return this.technicians.detail(technicianId);
  }

  @Post()
  @RequirePermissions('technicians.write')
  create(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(createTechnicianSchema)) dto: CreateTechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.technicians.create(auth.sub, dto, meta);
  }

  @Put(':id')
  @RequirePermissions('technicians.write')
  update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) technicianId: string,
    @Body(new ZodValidationPipe(technicianDetailsSchema)) dto: TechnicianDetailsDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.technicians.update(auth.sub, technicianId, dto, meta);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('technicians.write')
  activate(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) technicianId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.technicians.activate(auth.sub, technicianId, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('technicians.write')
  suspend(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) technicianId: string,
    @Body(new ZodValidationPipe(suspendTechnicianSchema)) dto: SuspendTechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.technicians.suspend(auth.sub, technicianId, dto, meta);
  }
}
