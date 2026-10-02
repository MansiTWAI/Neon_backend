import { describe, expect, it } from 'vitest';
import { SlidingWindow } from './sliding-window';

describe('SlidingWindow', () => {
  it('allows up to the limit within the window, then refuses', () => {
    const window = new SlidingWindow(2, 1000);
    expect(window.take('a', 0)).toBe(true);
    expect(window.take('a', 10)).toBe(true);
    expect(window.take('a', 20)).toBe(false);
    expect(window.take('b', 20)).toBe(true);
  });

  it('allows again once old events leave the window', () => {
    const window = new SlidingWindow(1, 1000);
    expect(window.take('a', 0)).toBe(true);
    expect(window.take('a', 999)).toBe(false);
    expect(window.take('a', 1000)).toBe(true);
  });
});
