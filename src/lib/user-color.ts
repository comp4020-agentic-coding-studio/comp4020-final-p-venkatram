// Deterministic per-user colour, derived from a userId — no server/schema
// change needed, since every caller already has the id (presence, lyrics
// comments). Fixed HSL palette rather than a free hash-to-hue, so every
// colour is readable as text and as a highlight background in both the
// light and dark themes (theme.css's palette is pastel-in-light,
// neon-in-dark; these sit in between and work against either surface).
const PALETTE = [
  "hsl(350 70% 60%)", // rose
  "hsl(265 60% 65%)", // violet
  "hsl(205 70% 55%)", // azure
  "hsl(165 55% 45%)", // teal
  "hsl(95 45% 45%)", // moss
  "hsl(35 80% 55%)", // amber
  "hsl(10 75% 55%)", // coral
  "hsl(230 55% 60%)", // indigo
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function colorForUserId(userId: string): string {
  return PALETTE[hashString(userId) % PALETTE.length] as string;
}
