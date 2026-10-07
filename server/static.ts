// Serves Astro's static build (dist/). Astro writes `foo/index.html` for a
// `/foo/` page, so a request for `/foo` (no slash) or `/foo/` both resolve to
// it; anything else not found falls through to a 404 page if there is one.
import type { ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function candidatePaths(distRoot: string, urlPath: string): string[] {
  const cleaned = urlPath.split("?")[0] ?? "/";
  const safe = normalize(cleaned).replace(/^(\.\.[/\\])+/, "");
  const base = join(distRoot, safe);
  return [base, join(base, "index.html"), `${base}.html`];
}

export function serveStatic(distRoot: string, urlPath: string, res: ServerResponse): boolean {
  const root = resolve(distRoot);
  for (const candidate of candidatePaths(distRoot, urlPath)) {
    const resolved = resolve(candidate);
    if (!resolved.startsWith(root)) continue; // no escaping dist/ via ../
    if (!existsSync(resolved) || !statSync(resolved).isFile()) continue;
    const type = CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(readFileSync(resolved));
    return true;
  }
  return false;
}
