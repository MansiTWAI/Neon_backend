import { createHmac } from 'node:crypto';

/**
 * The code a customer reads out to confirm their installation is done. It is derived from the
 * job and a server secret, so it never needs storing and only the customer's order page shows it.
 */
export function completionCode(jobId: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(`job-completion:${jobId}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
