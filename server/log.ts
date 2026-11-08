// One structured JSON line per user action, to stdout — `flyctl logs` already
// captures that, so this is the whole of crit 10's "server-side logging"
// requirement.
export interface LogEvent {
  ts: string;
  event: string;
  [field: string]: unknown;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): LogEvent {
  const entry: LogEvent = { ts: new Date().toISOString(), event, ...fields };
  console.log(JSON.stringify(entry));
  return entry;
}
