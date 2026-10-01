import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9-]{2,100}$/);

export const productQuerySchema = z.object({
  category: slug.optional(),
  tag: slug.optional(),
  q: z.string().trim().min(2).max(60).optional().catch(undefined),
  sort: z.enum(['featured', 'price-asc', 'price-desc', 'new']).default('featured').catch('featured'),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export const productSlugSchema = slug;
