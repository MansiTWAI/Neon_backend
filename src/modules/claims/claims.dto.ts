import { z } from 'zod';
import { pageSchema } from '../../common/http/pagination';

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 5;

export const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'DISPUTED', 'APPROVED', 'REJECTED', 'PAID'] as const;

const note = z.string().trim().max(1000);

export const createClaimSchema = z.object({
  /** Which eligible commissions to claim; all of them when left out. */
  commissionIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  note: note.optional(),
});
export type CreateClaimDto = z.infer<typeof createClaimSchema>;

export const submitClaimSchema = z.object({ note: note.optional() });
export type SubmitClaimDto = z.infer<typeof submitClaimSchema>;

export const claimListSchema = pageSchema.extend({
  status: z.enum(CLAIM_STATUSES).optional().catch(undefined),
  franchiseId: z.string().uuid().optional().catch(undefined),
});
export type ClaimListQuery = z.infer<typeof claimListSchema>;

export const approveClaimSchema = z.object({
  /** The bank transaction or ledger reference the evidence was matched against. */
  reconciledReference: z.string().trim().min(4, 'Enter the reference you matched').max(60),
  note: note.optional(),
});
export type ApproveClaimDto = z.infer<typeof approveClaimSchema>;

export const reviewNoteSchema = z.object({
  note: note.min(5, 'Say what is wrong, so the partner can act on it'),
});
export type ReviewNoteDto = z.infer<typeof reviewNoteSchema>;

/** PDF, JPG, PNG or WebP, judged by the bytes rather than the name or the browser's claim. */
export function sniffEvidence(body: Buffer): string | null {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** A name safe to show and to put in a Content-Disposition header. */
export function cleanFileName(name: string | undefined, mime: string): string {
  const extension = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[mime];
  const base = (name ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w .-]+/g, '')
    .trim()
    .slice(0, 100);
  return `${base || 'evidence'}.${extension ?? 'bin'}`;
}
