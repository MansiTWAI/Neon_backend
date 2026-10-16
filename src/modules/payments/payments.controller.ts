import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Meta, type RequestMeta } from '../../common/http/request-meta';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { orderNoSchema } from '../orders/orders.dto';
import {
  PaymentFailedDto,
  paymentFailedSchema,
  RefundDto,
  refundSchema,
  VerifyPaymentDto,
  verifyPaymentSchema,
} from './payments.dto';
import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './razorpay.gateway';

const orderNo = new ZodValidationPipe(orderNoSchema);

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly gateway: RazorpayGateway,
  ) {}

  @Post('orders/:orderNo/payments')
  @HttpCode(200)
  @Authenticated(['customer'])
  start(@CurrentAuth() auth: AccessClaims, @Param('orderNo', orderNo) no: string) {
    return this.payments.start(auth.sub, no);
  }

  @Post('orders/:orderNo/payments/verify')
  @HttpCode(200)
  @Authenticated(['customer'])
  verify(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(verifyPaymentSchema)) dto: VerifyPaymentDto,
  ) {
    return this.payments.verify(auth.sub, no, dto);
  }

  @Post('orders/:orderNo/payments/failed')
  @HttpCode(200)
  @Authenticated(['customer'])
  failed(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(paymentFailedSchema)) dto: PaymentFailedDto,
  ) {
    return this.payments.recordFailure(auth.sub, no, dto);
  }

  /** Razorpay calls this; it is trusted only through the signature over the exact bytes sent. */
  @Post('payments/razorpay/webhook')
  @HttpCode(200)
  async webhook(@Req() request: RawBodyRequest<FastifyRequest>) {
    if (!this.gateway.webhookConfigured) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_NOT_CONFIGURED',
        title: 'Webhook not configured',
      });
    }
    const signature = request.headers['x-razorpay-signature'];
    if (
      !request.rawBody ||
      !this.gateway.webhookSignatureValid(
        request.rawBody,
        typeof signature === 'string' ? signature : undefined,
      )
    ) {
      this.logger.warn('Rejected a Razorpay webhook with a missing or wrong signature');
      throw new UnauthorizedException({ code: 'SIGNATURE_INVALID', title: 'Signature does not match' });
    }
    await this.payments.handleWebhook(request.body as Parameters<PaymentsService['handleWebhook']>[0]);
    return { ok: true };
  }

  @Post('admin/orders/:orderNo/refunds')
  @Authenticated(['admin'])
  @RequirePermissions('payments.write')
  refund(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(refundSchema)) dto: RefundDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.payments.refund(auth.sub, no, dto, meta);
  }
}
