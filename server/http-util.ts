import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 1_000_000; // 1MB — plenty for JSON forms, not for file uploads

export class BadRequestError extends Error {}

// `maxBytes` lets a specific route (e.g. sheet-music uploads, base64-encoded
// MusicXML can run well past 1MB) raise the ceiling for its own body without
// loosening the shared default every other route relies on.
export function readJsonBody<T>(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new BadRequestError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new BadRequestError("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
