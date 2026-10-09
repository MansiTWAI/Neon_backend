/**
 * Language models sometimes forget a closing tag in long SVG. Browsers refuse to draw an SVG with
 * any markup error, so drawings are repaired where the fix is certain and rejected otherwise.
 */

const TAG =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)([^<>]*?)(\/?)>/g;
const ATTRIBUTES = /^(\s+[A-Za-z_:][\w:.-]*\s*=\s*("[^"<]*"|'[^'<]*'))*\s*$/;
const BARE_AMPERSAND = /&(?!(#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);)/;

/** Closes elements the model left open and drops closing tags that match nothing. */
export function balanceTags(svg: string): string {
  const open: string[] = [];
  let out = '';
  let last = 0;
  for (const match of svg.matchAll(TAG)) {
    out += svg.slice(last, match.index);
    last = match.index + match[0].length;
    const [whole, closing, name, , selfClosing] = match;
    if (!name || selfClosing) {
      out += whole;
    } else if (!closing) {
      open.push(name);
      out += whole;
    } else if (open.includes(name)) {
      while (open.length) {
        const top = open.pop()!;
        out += `</${top}>`;
        if (top === name) break;
      }
    }
    // A closing tag for an element that was never opened is dropped.
  }
  out += svg.slice(last);
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** True when every tag is balanced, every attribute quoted and no text holds a stray < or &. */
export function isWellFormed(svg: string): boolean {
  const open: string[] = [];
  let last = 0;
  for (const match of svg.matchAll(TAG)) {
    const text = svg.slice(last, match.index);
    if (text.includes('<') || BARE_AMPERSAND.test(text)) return false;
    last = match.index + match[0].length;
    const [, closing, name, attributes, selfClosing] = match;
    if (!name) continue;
    if (closing) {
      if (attributes?.trim() || open.pop() !== name) return false;
    } else {
      if (!ATTRIBUTES.test(attributes ?? '') || BARE_AMPERSAND.test(attributes ?? '')) return false;
      if (!selfClosing) open.push(name);
    }
  }
  const rest = svg.slice(last);
  return open.length === 0 && !rest.includes('<') && !BARE_AMPERSAND.test(rest);
}
