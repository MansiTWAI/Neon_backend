import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import { orderNoSchema } from '../../orders/orders.dto';
import { sniffImage } from '../../storage/storage.service';
import {
  InstallationDto,
  installationSchema,
  OrderListQuery,
  orderListSchema,
  RecordPaymentDto,
  recordPaymentSchema,
  StatusChangeDto,
  statusChangeSchema,
  TicketUpdateDto,
  ticketUpdateSchema,
} from './admin-orders.dto';
import { AdminOrdersService } from './admin-orders.service';

const orderNo = new ZodValidationPipe(orderNoSchema);

@Controller('admin/orders')
@Authenticated(['admin'])
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  list(@Query(new ZodValidationPipe(orderListSchema)) query: OrderListQuery) {
    return this.orders.list(query);
  }

  @Get(':orderNo')
  @RequirePermissions('orders.read')
  detail(@Param('orderNo', orderNo) no: string) {
    return this.orders.detail(no);
  }

  @Post(':orderNo/status')
  @HttpCode(200)
  @RequirePermissions('orders.update')
  changeStatus(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(statusChangeSchema)) dto: StatusChangeDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.orders.changeStatus(auth.sub, no, dto, meta);
  }

  @Post(':orderNo/payments')
  @HttpCode(200)
  @RequirePermissions('payments.write')
  recordPayment(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) dto: RecordPaymentDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.orders.recordPayment(auth.sub, no, dto, meta);
  }

  /** multipart/form-data: an optional `designerNote` field followed by the proof image as `file`. */
  @Post(':orderNo/items/:itemId/proofs')
  @HttpCode(200)
  @RequirePermissions('orders.update')
  async sendProof(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: FastifyRequest,
    @Meta() meta: RequestMeta,
  ) {
    let body: Buffer | null = null;
    let note: string | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') body = await part.toBuffer();
        else if (part.fieldname === 'designerNote') note = String(part.value).trim().slice(0, 1000);
      }
    } catch {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'Proof images can be up to 10 MB' });
    }

    const type = body && sniffImage(body);
    if (!body || !type) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        title: 'Attach the proof as a PNG, JPG or WebP image',
      });
    }
    return this.orders.sendProof(auth.sub, no, itemId, { body, type }, note, meta);
  }

  @Put(':orderNo/installation')
  @RequirePermissions('orders.update')
  scheduleInstallation(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(installationSchema)) dto: InstallationDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.orders.scheduleInstallation(auth.sub, no, dto, meta);
  }

  @Post(':orderNo/tickets/:ticketId')
  @HttpCode(200)
  @RequirePermissions('orders.update')
  updateTicket(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body(new ZodValidationPipe(ticketUpdateSchema)) dto: TicketUpdateDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.orders.updateTicket(auth.sub, no, ticketId, dto, meta);
  }
}
