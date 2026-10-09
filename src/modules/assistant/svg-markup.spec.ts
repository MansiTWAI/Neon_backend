import { describe, expect, it } from 'vitest';
import { balanceTags, isWellFormed } from './svg-markup';

describe('balanceTags', () => {
  it('closes an element the model forgot to close', () => {
    // Taken from a real Gemini drawing: </feMerge> is missing.
    const broken =
      '<svg><defs><filter id="glow"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode in="SourceGraphic"/></filter></defs><rect/></svg>';
    const fixed = balanceTags(broken);
    expect(fixed).toBe(
      '<svg><defs><filter id="glow"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect/></svg>',
    );
    expect(isWellFormed(fixed)).toBe(true);
  });

  it('drops a closing tag that matches nothing and closes what is left open', () => {
    expect(balanceTags('<svg><g><circle/></path></g><g>')).toBe('<svg><g><circle/></g><g></g></svg>');
  });

  it('leaves comments and CDATA alone', () => {
    const svg = '<svg><!-- <g> --><style><![CDATA[ .a > .b {} ]]></style></svg>';
    expect(balanceTags(svg)).toBe(svg);
    expect(isWellFormed(svg)).toBe(true);
  });
});

describe('isWellFormed', () => {
  it('accepts ordinary SVG', () => {
    expect(isWellFormed('<svg viewBox="0 0 10 10"><path d="M0 0L10 10" fill=\'#f00\'/>&amp;</svg>')).toBe(
      true,
    );
  });

  it.each([
    ['an unquoted attribute', '<svg><rect width=10/></svg>'],
    ['a bare ampersand', '<svg><desc>Rahul & Priya</desc></svg>'],
    ['crossed tags', '<svg><g><defs></g></defs></svg>'],
    ['a stray <', '<svg>a < b</svg>'],
  ])('rejects %s', (_, svg) => {
    expect(isWellFormed(svg)).toBe(false);
  });
});
