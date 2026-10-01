import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import {
  CreateFranchiseDto,
  createFranchiseSchema,
  FranchiseDto,
  franchiseListSchema,
  franchiseSchema,
  TechnicianDto,
  technicianSchema,
  TerritoryDto,
  territorySchema,
} from './admin-franchises.dto';
import { AdminFranchisesService } from './admin-franchises.service';

const id = new ParseUUIDPipe();

@Controller('admin/franchises')
@Authenticated(['admin'])
export class AdminFranchisesController {
  constructor(private readonly franchises: AdminFranchisesService) {}

  @Get()
  @RequirePermissions('franchises.read')
  list(@Query(new ZodValidationPipe(franchiseListSchema)) { q }: z.infer<typeof franchiseListSchema>) {
    return this.franchises.list(q);
  }

  @Get('tiers')
  @RequirePermissions('franchises.read')
  tiers() {
    return this.franchises.tiers();
  }

  @Get(':id')
  @RequirePermissions('franchises.read')
  detail(@Param('id', id) franchiseId: string) {
    return this.franchises.detail(franchiseId);
  }

  @Post()
  @RequirePermissions('franchises.write')
  create(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(createFranchiseSchema)) dto: CreateFranchiseDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.create(auth.sub, dto, meta);
  }

  @Put(':id')
  @RequirePermissions('franchises.write')
  update(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) franchiseId: string,
    @Body(new ZodValidationPipe(franchiseSchema)) dto: FranchiseDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.update(auth.sub, franchiseId, dto, meta);
  }

  @Put(':id/territories')
  @RequirePermissions('franchises.write')
  territories(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) franchiseId: string,
    @Body(new ZodValidationPipe(territorySchema)) dto: TerritoryDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.territories(auth.sub, franchiseId, dto, meta);
  }

  @Post(':id/technicians')
  @RequirePermissions('franchises.write')
  addTechnician(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) franchiseId: string,
    @Body(new ZodValidationPipe(technicianSchema)) dto: TechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.saveTechnician(auth.sub, franchiseId, null, dto, meta);
  }

  @Put(':id/technicians/:technicianId')
  @RequirePermissions('franchises.write')
  updateTechnician(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) franchiseId: string,
    @Param('technicianId', id) technicianId: string,
    @Body(new ZodValidationPipe(technicianSchema)) dto: TechnicianDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.saveTechnician(auth.sub, franchiseId, technicianId, dto, meta);
  }

  @Post(':id/owner/reset-password')
  @HttpCode(200)
  @RequirePermissions('franchises.write')
  resetOwnerPassword(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) franchiseId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.franchises.resetOwnerPassword(auth.sub, franchiseId, meta);
  }
}
