// Shared so the client's cursor and the server's parsing agree on what a
// line is. Parsing itself only ever runs server-side (an upload is a REST
// call, not a per-keystroke thing), but the type and the format are shared.
export interface LyricLine {
  time: number; // ms from the start of the piece
  text: string;
}

const LRC_LINE = /^\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\](.*)$/;
const FALLBACK_LINE_SPACING_MS = 4000;

// Real LRC timestamps (`[mm:ss.xx]text`) if the upload has any; otherwise
// falls back to evenly-spaced lines so a plain lyric sheet still produces a
// cursor, just a less accurate one — better than refusing the upload.
export function parseLyrics(raw: string): LyricLine[] {
  const timed: LyricLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const match = LRC_LINE.exec(rawLine);
    if (!match) continue;
    const text = match[3]?.trim() ?? "";
    if (text.length === 0) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    timed.push({ time: Math.round((minutes * 60 + seconds) * 1000), text });
  }
  if (timed.length > 0) return timed.sort((a, b) => a.time - b.time);

  const plainLines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return plainLines.map((text, index) => ({ time: index * FALLBACK_LINE_SPACING_MS, text }));
}
