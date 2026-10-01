/** Typefaces used for neon lettering, served from Google Fonts. Keep in step with the seeded fonts. */
export const NEON_FONT_FAMILIES = [
  'Bungee',
  'Dancing Script:wght@600',
  'Great Vibes',
  'Lobster',
  'Monoton',
  'Neonderthaw',
  'Pacifico',
  'Righteous',
  'Sacramento',
  'Satisfy',
  'Tilt Neon',
  'Yellowtail',
];

export const NEON_FONTS_STYLESHEET = `https://fonts.googleapis.com/css2?${NEON_FONT_FAMILIES.map(
  (family) => `family=${family.replaceAll(' ', '+')}`,
).join('&')}&display=swap`;
