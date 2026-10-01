import { z } from 'zod';

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).catch(25),
});
export type PageQuery = z.infer<typeof pageSchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export function pageOf<T>(items: T[], total: number, { page, pageSize }: PageQuery): Page<T> {
  return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const skipTake = ({ page, pageSize }: PageQuery) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Optional free-text search; blank strings mean "no filter". */
export const searchSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => value || undefined);
