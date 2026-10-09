import { describe, expect, it } from 'vitest';
import { cleanSvg } from './image-models';

const drawing = (inner: string, attrs = 'viewBox="0 0 10 10"') =>
  `Here you go:\n\`\`\`svg\n<svg ${attrs}>${inner}${'<circle cx="5" cy="5" r="4"/>'.repeat(10)}</svg>\n\`\`\``;

describe('cleanSvg', () => {
  it('keeps only the drawing and gives it a fixed size', () => {
    const svg = cleanSvg(drawing('<rect width="10" height="10" fill="url(#g)"/>'), 1024, 768)!;
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"',
      ),
    ).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('url(#g)');
  });

  it('removes scripts, embedded HTML, handlers, text and outside links', () => {
    const svg = cleanSvg(
      drawing(
        '<script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="https://x.test"><circle onload="alert(1)"/></a>' +
          '<image href="https://x.test/a.png"/><text>Priya</text><rect style="fill:url(https://x.test/p)"/><animate attributeName="r"/>',
      ),
      100,
      100,
    )!;
    expect(svg).not.toMatch(/script|foreignObject|onload|https:|<image|<text|<a\b/);
    // Similar-looking tags survive.
    expect(svg).toContain('<animate');
  });

  it('returns null when the drawing is missing or cut off', () => {
    expect(cleanSvg('Sorry, I cannot draw that.', 100, 100)).toBeNull();
    expect(cleanSvg('<svg viewBox="0 0 10 10"><circle', 100, 100)).toBeNull();
  });
});
