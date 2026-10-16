import { describe, expect, it, vi } from 'vitest';
import { CheckoutService } from './checkout.service';
import type { PlaceOrderDto } from './orders.dto';

/** The real placing is stubbed: these tests are about requests that arrive twice. */
function serviceWith(placeOnce: (userId: string, dto: PlaceOrderDto) => Promise<{ orderNo: string }>) {
  const stub = vi.fn(placeOnce);
  const service = Object.create(CheckoutService.prototype) as CheckoutService;
  Object.assign(service, { recent: new Map(), placeOnce: stub });
  return { service, placeOnce: stub };
}

const dto = {
  lines: [],
  addressId: '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7c',
  installation: false,
  paymentMode: 'COD',
  expectedPayablePaise: 250000,
} as unknown as PlaceOrderDto;

describe('placing the same order twice', () => {
  it('places one order when the same request arrives twice at once', async () => {
    let next = 1;
    const { service, placeOnce } = serviceWith(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { orderNo: `NA0000${next++}` };
    });
    const [first, second] = await Promise.all([service.place('u1', dto), service.place('u1', dto)]);
    expect(first).toEqual({ orderNo: 'NA00001' });
    expect(second).toEqual(first);
    expect(placeOnce).toHaveBeenCalledTimes(1);
  });

  it('treats different customers and different orders as separate', async () => {
    let next = 1;
    const { service, placeOnce } = serviceWith(async () => ({ orderNo: `NA0000${next++}` }));
    await service.place('u1', dto);
    await service.place('u2', dto);
    await service.place('u1', { ...dto, installation: true });
    expect(placeOnce).toHaveBeenCalledTimes(3);
  });

  it('lets a failed order be tried again straight away', async () => {
    const { service, placeOnce } = serviceWith(() => Promise.reject(new Error('stock changed')));
    await expect(service.place('u1', dto)).rejects.toThrow('stock changed');
    await expect(service.place('u1', dto)).rejects.toThrow('stock changed');
    expect(placeOnce).toHaveBeenCalledTimes(2);
  });

  it('places a new order after the customer cancels the first one', async () => {
    let next = 1;
    const { service, placeOnce } = serviceWith(async () => ({ orderNo: `NA0000${next++}` }));
    await service.place('u1', dto);
    service.forgetRecent('u1');
    await expect(service.place('u1', dto)).resolves.toEqual({ orderNo: 'NA00002' });
    expect(placeOnce).toHaveBeenCalledTimes(2);
  });
});
