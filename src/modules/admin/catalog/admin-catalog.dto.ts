import { z } from 'zod';
import { pageSchema, searchSchema } from '../../../common/http/pagination';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lower-case words joined by hyphens')
  .max(100);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug,
  description: z.string().trim().max(300).nullable().default(null),
  sort: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const productListSchema = pageSchema.extend({
  q: searchSchema,
  categoryId: z.string().uuid().optional().catch(undefined),
});
export type ProductListQuery = z.infer<typeof productListSchema>;

const size = z.object({
  label: z.string().trim().min(1).max(20),
  widthIn: z.number().min(6).max(240),
  heightIn: z.number().min(2).max(240),
});

export const productSchema = z
  .object({
    categoryId: z.string().uuid(),
    type: z.enum(['TEXT_NEON', 'LOGO_NEON', 'READYMADE', 'BUSINESS']),
    pricingMode: z.enum(['INSTANT', 'QUOTE']),
    name: z.string().trim().min(2).max(120),
    slug,
    description: z.string().trim().max(1000).nullable().default(null),
    design: z
      .object({
        lines: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(30),
              colorName: z.string().max(40),
              glowHex: hex,
              tubeHex: hex,
            }),
          )
          .min(1)
          .max(3),
        fontFamily: z.string().trim().min(1).max(80),
        backboardCode: z.string().regex(/^[A-Z0-9_]{2,30}$/),
      })
      .nullable()
      .default(null),
    sizes: z.array(size).max(6).default([]),
    highlights: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
    tags: z.array(slug).max(15).default([]),
    leadTimeDays: z.number().int().min(1).max(60),
    rateOverridePaise: z.number().int().min(100).max(10_000_000).nullable().default(null),
    isFeatured: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((product, ctx) => {
    if (product.type === 'READYMADE' && !product.design) {
      ctx.addIssue({ code: 'custom', path: ['design'], message: 'Ready-made signs need their lettering' });
    }
    if (product.type === 'READYMADE' && product.sizes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['sizes'], message: 'Add at least one size' });
    }
  });
export type ProductDto = z.infer<typeof productSchema>;
