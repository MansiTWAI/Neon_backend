import { describe, expect, it, vi } from 'vitest';
import type { Payment } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { GatewayPayment, RazorpayGateway, razorpaySignature } from './razorpay.gateway';

const SECRET = 'test_secret_for_unit_tests';
const WEBHOOK_SECRET = 'webhook_secret_for_unit_tests';

function gateway(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    RAZORPAY_KEY_ID: 'rzp_test_unit',
    RAZORPAY_KEY_SECRET: SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_API_URL: 'http://127.0.0.1:9/v1',
    ...overrides,
  };
  return new RazorpayGateway({ get: (key: string) => values[key] } as never);
}

const payment: Payment = {
  id: 'p1',
  orderId: 'o1',
  purpose: 'FULL',
  method: 'RAZORPAY',
  amountPaise: 250_000n,
  status: 'CREATED',
  gatewayOrderId: 'order_ABC123456',
  gatewayPaymentId: null,
  gatewayMethod: null,
  reference: null,
  proofKey: null,
  recordedBy: null,
  raw: null,
  capturedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const remote = (patch: Partial<GatewayPayment> = {}): GatewayPayment => ({
  id: 'pay_XYZ123456',
  order_id: 'order_ABC123456',
  amount: 250_000,
  currency: 'INR',
  status: 'captured',
  method: 'upi',
  ...patch,
});

function service(gw = gateway()) {
  const order = {
    id: 'o1',
    orderNo: 'NA10001',
    customerId: 'u1',
    status: 'PENDING_PAYMENT',
    totalPaise: 250_000n,
    amountPaidPaise: 0n,
  };
  const tx = {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    order: { findUniqueOrThrow: vi.fn().mockResolvedValue(order), update: vi.fn() },
  };
  const prisma = {
    order: { findUniqueOrThrow: vi.fn().mockResolvedValue(order) },
    payment: { findFirst: vi.fn().mockResolvedValue(payment) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const workflow = { confirm: vi.fn(), load: vi.fn().mockResolvedValue(order) };
  const notifications = { notify: vi.fn() };
  const audit = { record: vi.fn() };
  const svc = new PaymentsService(
    prisma as never,
    gw,
    workflow as never,
    notifications as never,
    audit as never,
  );
  return { svc, prisma, tx, workflow, notifications };
}

describe('Razorpay signatures', () => {
  it('accepts the checkout signature Razorpay computes, and nothing else', () => {
    const gw = gateway();
    const good = razorpaySignature('order_ABC123456|pay_XYZ123456', SECRET);
    expect(gw.checkoutSignatureValid('order_ABC123456', 'pay_XYZ123456', good)).toBe(true);
    expect(gw.checkoutSignatureValid('order_ABC123456', 'pay_OTHER12345', good)).toBe(false);
    expect(
      gw.checkoutSignatureValid('order_ABC123456', 'pay_XYZ123456', razorpaySignature('x', 'wrong')),
    ).toBe(false);
  });

  it('checks webhooks over the exact bytes, with the webhook secret', () => {
    const gw = gateway();
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(gw.webhookSignatureValid(body, razorpaySignature(body, WEBHOOK_SECRET))).toBe(true);
    expect(gw.webhookSignatureValid(body, razorpaySignature(body, SECRET))).toBe(false);
    expect(
      gw.webhookSignatureValid(
        Buffer.from('{"event": "payment.captured"}'),
        razorpaySignature(body, WEBHOOK_SECRET),
      ),
    ).toBe(false);
    expect(gw.webhookSignatureValid(body, undefined)).toBe(false);
  });

  it('refuses every signature when the secrets are not set', () => {
    const gw = gateway({
      RAZORPAY_KEY_SECRET: undefined,
      RAZORPAY_KEY_ID: undefined,
      RAZORPAY_WEBHOOK_SECRET: undefined,
    });
    expect(gw.configured).toBe(false);
    expect(gw.checkoutSignatureValid('order_A', 'pay_B', razorpaySignature('order_A|pay_B', ''))).toBe(false);
    expect(gw.webhookSignatureValid(Buffer.from('{}'), razorpaySignature('{}', ''))).toBe(false);
  });
});

describe('settling a payment', () => {
  it('marks the order paid and confirms it for a captured payment of the right amount', async () => {
    const { svc, tx, workflow } = service();
    await expect(svc.settle(payment, remote(), 'checkout')).resolves.toBe('paid');
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CAPTURED', gatewayPaymentId: 'pay_XYZ123456' }),
      }),
    );
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: 'PAID', amountDuePaise: 0n }),
      }),
    );
    expect(workflow.confirm).toHaveBeenCalledOnce();
  });

  it('does nothing the second time the same payment arrives', async () => {
    const { svc, tx, workflow } = service();
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.settle(payment, remote(), 'webhook')).resolves.toBe('already-paid');
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(workflow.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['a smaller amount', { amount: 1_000 }],
    ['another gateway order', { order_id: 'order_OTHER1234' }],
    ['another currency', { currency: 'USD' }],
  ])('never marks paid for %s', async (_label, patch) => {
    const { svc, prisma } = service();
    await expect(svc.settle(payment, remote(patch), 'checkout')).rejects.toMatchObject({
      response: { code: 'PAYMENT_MISMATCH' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'failed'],
    ['created', 'pending'],
  ] as const)('reports a %s payment without marking anything paid', async (status, outcome) => {
    const { svc, prisma } = service();
    await expect(svc.settle(payment, remote({ status }), 'checkout')).resolves.toBe(outcome);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('verifying a checkout result', () => {
  it('rejects a forged signature before asking Razorpay or touching the order', async () => {
    const gw = gateway();
    const fetchPayment = vi.spyOn(gw, 'fetchPayment');
    const { svc, prisma } = service(gw);
    await expect(
      svc.verify('u1', 'NA10001', {
        gatewayOrderId: 'order_ABC123456',
        paymentId: 'pay_XYZ123456',
        signature: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_VERIFIED' } });
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('settles from what Razorpay reports, not from the browser', async () => {
    const gw = gateway();
    vi.spyOn(gw, 'fetchPayment').mockResolvedValue(remote({ status: 'failed' }));
    const { svc, prisma } = service(gw);
    const signature = razorpaySignature('order_ABC123456|pay_XYZ123456', SECRET);
    await expect(
      svc.verify('u1', 'NA10001', {
        gatewayOrderId: 'order_ABC123456',
        paymentId: 'pay_XYZ123456',
        signature,
      }),
    ).resolves.toEqual({ outcome: 'failed', orderNo: 'NA10001' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
