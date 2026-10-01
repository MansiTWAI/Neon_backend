/**
 * Amounts are integer paise throughout the platform. Floating point only appears
 * transiently inside a calculation and is rounded back before it is stored.
 */

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

/** Area in hundredths of a square foot, always rounded up: 24" × 11" → 184 (1.84 sq ft). */
export function areaHundredths(widthIn: number, heightIn: number): number {
  return Math.ceil((widthIn * heightIn * 100) / 144 - 1e-9);
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatINR(amountPaise: number, { paise = false }: { paise?: boolean } = {}): string {
  return (paise ? inr : inrWhole).format(amountPaise / 100);
}
