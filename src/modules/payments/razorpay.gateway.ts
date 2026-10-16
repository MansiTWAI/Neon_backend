import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { safeEqual } from '../../common/security/crypto';
import { Env } from '../../config/env';

const TIMEOUT_MS = 15_000;

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created, authorized, captured, refunded or failed. */
  status: string;
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
}

export interface GatewayRefund {
  id: string;
  payment_id: string;
  amount: number;
  /** pending, processed or failed. */
  status: string;
}

/** HMAC-SHA256 in hex, as Razorpay signs both checkout results and webhooks. */
export function razorpaySignature(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Razorpay's REST API, called directly. Nothing here decides that an order is paid: callers check
 * the signature and then the payment as Razorpay reports it, never what the browser says.
 */
@Injectable()
export class RazorpayGateway {
  private readonly logger = new Logger(RazorpayGateway.name);
  private readonly keyId?: string;
  private readonly keySecret?: string;
  private readonly webhookSecret?: string;
  private readonly api: string;

  constructor(config: ConfigService<Env, true>) {
    this.api = config.get('RAZORPAY_API_URL', { infer: true });
    this.keyId = config.get('RAZORPAY_KEY_ID', { infer: true });
    this.keySecret = config.get('RAZORPAY_KEY_SECRET', { infer: true });
    this.webhookSecret = config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true });
  }

  get configured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  /** The public key the browser's checkout needs. Never the secret. */
  get publicKey(): string {
    return this.keyId ?? '';
  }

  get testMode(): boolean {
    return Boolean(this.keyId?.startsWith('rzp_test_'));
  }

  /** The signature Razorpay's checkout returns is HMAC(order_id|payment_id) with the API secret. */
  checkoutSignatureValid(gatewayOrderId: string, paymentId: string, signature: string): boolean {
    if (!this.keySecret) return false;
    return safeEqual(razorpaySignature(`${gatewayOrderId}|${paymentId}`, this.keySecret), signature);
  }

  /** Webhooks are signed over the exact bytes sent, with the webhook's own secret. */
  webhookSignatureValid(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) return false;
    return safeEqual(razorpaySignature(rawBody, this.webhookSecret), signature);
  }

  get webhookConfigured(): boolean {
    return Boolean(this.webhookSecret);
  }

  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    return this.call<GatewayOrder>('POST', '/orders', {
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes,
    });
  }

  fetchPayment(paymentId: string) {
    return this.call<GatewayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Every attempt made against one of our gateway orders, e.g. to find a payment whose callback was lost. */
  orderPayments(gatewayOrderId: string) {
    return this.call<{ items: GatewayPayment[] }>(
      'GET',
      `/orders/${encodeURIComponent(gatewayOrderId)}/payments`,
    );
  }

  /** For accounts that do not capture automatically: takes an authorised payment. */
  capture(paymentId: string, amountPaise: number) {
    return this.call<GatewayPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount: amountPaise,
      currency: 'INR',
    });
  }

  refund(paymentId: string, amountPaise: number, notes: Record<string, string>) {
    return this.call<GatewayRefund>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
      amount: amountPaise,
      notes,
    });
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'ONLINE_PAYMENT_UNAVAILABLE',
        title: 'Online payment is not available right now. Choose cash on delivery.',
      });
    }
    let response: Response;
    try {
      response = await fetch(`${this.api}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `Razorpay ${method} ${path} did not answer`,
        error instanceof Error ? error.message : error,
      );
      throw this.unreachable();
    }
    const data = (await response.json().catch(() => null)) as
      (T & { error?: { description?: string } }) | null;
    if (!response.ok || !data) {
      // The description can name the payment but holds no card or account data.
      this.logger.warn(
        `Razorpay ${method} ${path} answered ${response.status}: ${data?.error?.description ?? ''}`,
      );
      throw this.unreachable(response.status);
    }
    return data;
  }

  private unreachable(status?: number) {
    return new ServiceUnavailableException({
      code: 'PAYMENT_GATEWAY_ERROR',
      title: 'We could not reach the payment service. Please try again in a moment.',
      gatewayStatus: status,
    });
  }
}
