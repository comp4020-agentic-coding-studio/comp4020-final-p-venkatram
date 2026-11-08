// The only file that reads YOUTUBE_API_KEY and calls out to YouTube's Data
// API — kept out of shared/youtube.ts deliberately, since that file is
// bundled into the client build too (Astro picks up src/lib/* imports of
// shared/*). A key here never leaves the server.
export interface YoutubeSearchResult {
  youtubeId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export class YoutubeSearchNotConfiguredError extends Error {}
export class YoutubeSearchFailedError extends Error {}

interface YoutubeApiItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; thumbnails?: { default?: { url?: string } } };
}

// Appends "karaoke lyrics" to whatever the user typed, since YouTube's search
// API has no dedicated karaoke/lyric-video filter — this widens results to
// either style of sing-along video without a second round of client-side
// filtering that could hide legitimately relevant, differently-worded titles.
export async function searchYoutube(query: string): Promise<YoutubeSearchResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new YoutubeSearchNotConfiguredError("YouTube search is not configured on this server.");

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("q", `${trimmed} karaoke lyrics`);
  url.searchParams.set("key", apiKey);

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new YoutubeSearchFailedError("Couldn't reach YouTube. Try again.");
  }
  if (!res.ok) throw new YoutubeSearchFailedError(`YouTube search failed (${res.status}).`);

  const data = (await res.json()) as { items?: YoutubeApiItem[] };
  const results: YoutubeSearchResult[] = [];
  for (const item of data.items ?? []) {
    const youtubeId = item.id?.videoId;
    if (!youtubeId) continue;
    results.push({
      youtubeId,
      title: item.snippet?.title ?? "Untitled",
      channelTitle: item.snippet?.channelTitle ?? "",
      thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? "",
    });
  }
  return results;
}
