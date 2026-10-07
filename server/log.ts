// One structured JSON line per user action, to stdout — `flyctl logs` already
// captures that, so this is the whole of crit 10's "server-side logging"
// requirement. The ring buffer + subscriber list back the live /activity view
// (served over SSE from server/index.ts) without any extra infra: a tailed
// terminal and a browser page both read the same stream.
export interface LogEvent {
  ts: string;
  event: string;
  [field: string]: unknown;
}

const RING_SIZE = 200;
const ring: LogEvent[] = [];
type Listener = (event: LogEvent) => void;
const listeners = new Set<Listener>();

export function logEvent(event: string, fields: Record<string, unknown> = {}): LogEvent {
  const entry: LogEvent = { ts: new Date().toISOString(), event, ...fields };
  console.log(JSON.stringify(entry));
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  for (const listener of listeners) listener(entry);
  return entry;
}

export function recentEvents(): LogEvent[] {
  return [...ring];
}

export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
