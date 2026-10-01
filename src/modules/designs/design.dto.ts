import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a #RRGGBB colour');
const code = z.string().regex(/^[A-Z0-9_]{2,30}$/);

const tube = { colorName: z.string().trim().min(1).max(40), glowHex: hex, tubeHex: hex };

export const textConfigSchema = z.object({
  mode: z.literal('TEXT'),
  lines: z
    .array(z.object({ text: z.string().trim().min(1, 'A line is empty').max(30), ...tube }))
    .min(1)
    .max(3),
  fontFamily: z.string().trim().min(1).max(80),
  backgroundCode: code.optional(),
});

export const logoConfigSchema = z.object({
  mode: z.literal('LOGO'),
  uploadId: z.string().uuid(),
  ...tube,
});

export const designConfigSchema = z.discriminatedUnion('mode', [textConfigSchema, logoConfigSchema]);
export type DesignConfig = z.infer<typeof designConfigSchema>;

/** A sign as the studio describes it. Prices are never accepted from the client. */
export const designSchema = z.object({
  productId: z.string().uuid(),
  config: designConfigSchema,
  widthIn: z.number().min(4).max(600),
  heightIn: z.number().min(2).max(600),
  backboardCode: code,
  addonCodes: z.array(code).max(10).default([]),
});
export type DesignInput = z.infer<typeof designSchema>;

/** Canvas exports are JPEGs of a few tens of kilobytes; anything near this limit is not a preview. */
export const previewSchema = z
  .string()
  .max(1_500_000, 'Preview image is too large')
  .regex(/^data:image\/(jpeg|png|webp);base64,/, 'Preview must be an image');

export const saveDesignSchema = designSchema.extend({
  name: z.string().trim().max(60).optional(),
  preview: previewSchema.optional(),
});
export type SaveDesignDto = z.infer<typeof saveDesignSchema>;

export function colorCountOf(config: DesignConfig): number {
  return config.mode === 'TEXT' ? new Set(config.lines.map((line) => line.glowHex.toUpperCase())).size : 1;
}

/** One-line description used on order items, invoices and in the admin panel. */
export function describeDesign(design: DesignInput, backboardName: string): string {
  const { config } = design;
  const subject =
    config.mode === 'TEXT'
      ? `"${config.lines.map((line) => line.text).join(' / ')}" neon sign`
      : 'Logo neon sign';
  const colours =
    config.mode === 'TEXT'
      ? [...new Set(config.lines.map((line) => line.colorName))].join(', ')
      : config.colorName;
  return `${subject}, ${colours}, ${design.widthIn}" × ${design.heightIn}", ${backboardName}`;
}

/** The words and colours of a text design, so clients can draw it without a preview image. */
export function letteringOf(config: unknown) {
  const parsed = textConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  return {
    fontFamily: parsed.data.fontFamily,
    lines: parsed.data.lines.map(({ text, glowHex, tubeHex }) => ({ text, glowHex, tubeHex })),
  };
}
