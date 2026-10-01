import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Authenticated, CurrentAuth } from '../auth/auth.decorators';
import { AccessClaims } from '../auth/auth.types';
import { CheckoutService } from './checkout.service';
import {
  CancelOrderDto,
  cancelOrderSchema,
  CheckoutPriceDto,
  checkoutPriceSchema,
  orderNoSchema,
  PlaceOrderDto,
  placeOrderSchema,
  ProofDecisionDto,
  proofDecisionSchema,
  ReviewDto,
  reviewSchema,
  TicketDto,
  ticketSchema,
} from './orders.dto';
import { OrdersService } from './orders.service';

const orderNo = new ZodValidationPipe(orderNoSchema);

@Controller()
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  /** Public so the cart can show delivery, installation and GST before the customer signs in. */
  @Post('checkout/price')
  @HttpCode(200)
  price(@Body(new ZodValidationPipe(checkoutPriceSchema)) dto: CheckoutPriceDto) {
    return this.checkout.price(dto);
  }

  @Post('orders')
  @Authenticated(['customer'])
  place(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(placeOrderSchema)) dto: PlaceOrderDto,
  ) {
    return this.checkout.place(auth.sub, dto);
  }

  @Get('orders')
  @Authenticated(['customer'])
  list(@CurrentAuth() auth: AccessClaims) {
    return this.orders.list(auth.sub);
  }

  @Get('orders/:orderNo')
  @Authenticated(['customer'])
  detail(@CurrentAuth() auth: AccessClaims, @Param('orderNo', orderNo) no: string) {
    return this.orders.detail(auth.sub, no);
  }

  @Post('orders/:orderNo/cancel')
  @HttpCode(200)
  @Authenticated(['customer'])
  cancel(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) dto: CancelOrderDto,
  ) {
    return this.orders.cancel(auth.sub, no, dto);
  }

  @Post('orders/:orderNo/proofs/:proofId')
  @HttpCode(200)
  @Authenticated(['customer'])
  respondToProof(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body(new ZodValidationPipe(proofDecisionSchema)) dto: ProofDecisionDto,
  ) {
    return this.orders.respondToProof(auth.sub, no, proofId, dto);
  }

  @Post('orders/:orderNo/review')
  @HttpCode(200)
  @Authenticated(['customer'])
  review(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(reviewSchema)) dto: ReviewDto,
  ) {
    return this.orders.review(auth.sub, no, dto);
  }

  @Post('orders/:orderNo/tickets')
  @HttpCode(200)
  @Authenticated(['customer'])
  openTicket(
    @CurrentAuth() auth: AccessClaims,
    @Param('orderNo', orderNo) no: string,
    @Body(new ZodValidationPipe(ticketSchema)) dto: TicketDto,
  ) {
    return this.orders.openTicket(auth.sub, no, dto);
  }
}
