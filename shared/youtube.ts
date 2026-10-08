// Extracts and validates a YouTube video id from whatever URL shape someone
// pastes (watch/shorts/youtu.be/embed links all carry the same 11-character
// id, just in different places) — the server only ever stores this id, never
// the raw pasted URL, so the embedded iframe's src is always something this
// app built itself, not user-supplied HTML.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed; // already just an id

  try {
    const url = new URL(trimmed);
    if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== "youtu.be") return null;

    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    const vParam = url.searchParams.get("v");
    if (vParam && VIDEO_ID_RE.test(vParam)) return vParam;

    const pathMatch = /\/(?:embed|shorts)\/([^/?]+)/.exec(url.pathname);
    if (pathMatch && VIDEO_ID_RE.test(pathMatch[1] ?? "")) return pathMatch[1] as string;

    return null;
  } catch {
    return null; // not a URL and not a bare id
  }
}
