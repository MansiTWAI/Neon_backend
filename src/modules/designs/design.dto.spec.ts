import { describe, expect, it } from 'vitest';
import { colorCountOf, describeDesign, designSchema } from './design.dto';

const design = {
  productId: '0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7b',
  config: {
    mode: 'TEXT' as const,
    lines: [
      { text: 'Good', colorName: 'Hot Pink', glowHex: '#FF2E88', tubeHex: '#FFD1EA' },
      { text: 'Vibes', colorName: 'Ice Blue', glowHex: '#22d3ee', tubeHex: '#DDF8FF' },
    ],
    fontFamily: 'Neonderthaw',
  },
  widthIn: 24,
  heightIn: 14,
  backboardCode: 'CLR_CUT',
};

describe('designSchema', () => {
  it('accepts a studio design and defaults the add-ons', () => {
    const parsed = designSchema.parse(design);
    expect(parsed.addonCodes).toEqual([]);
  });

  it('rejects an empty line and a malformed colour', () => {
    const result = designSchema.safeParse({
      ...design,
      config: {
        ...design.config,
        lines: [{ text: '  ', colorName: 'Red', glowHex: 'red', tubeHex: '#FFFFFF' }],
      },
    });
    expect(result.success).toBe(false);
    const fields = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['config.lines.0.text', 'config.lines.0.glowHex']));
  });

  it('ignores any price sent by the client', () => {
    const parsed = designSchema.parse({ ...design, unitPricePaise: 1 });
    expect(parsed).not.toHaveProperty('unitPricePaise');
  });
});

describe('colorCountOf', () => {
  it('counts distinct glow colours regardless of case', () => {
    expect(colorCountOf(designSchema.parse(design).config)).toBe(2);
    const sameColour = {
      ...design.config,
      lines: design.config.lines.map((line) => ({ ...line, glowHex: '#ff2e88' })),
    };
    expect(colorCountOf(sameColour)).toBe(1);
  });
});

describe('describeDesign', () => {
  it('reads naturally on an invoice', () => {
    expect(describeDesign(designSchema.parse(design), 'Clear acrylic, cut to shape')).toBe(
      '"Good / Vibes" neon sign, Hot Pink, Ice Blue, 24" × 14", Clear acrylic, cut to shape',
    );
  });
});
