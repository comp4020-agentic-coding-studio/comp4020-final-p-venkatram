// Drives /activity/: the crit 10 "live view of logs" requirement. Backed by
// server/log.ts's ring buffer + SSE stream — no dashboard tooling, just a
// page that shows the same structured lines `flyctl logs` would.
interface LogEntry {
  ts: string;
  event: string;
  [field: string]: unknown;
}

function renderLine(entry: LogEntry): HTMLLIElement {
  const li = document.createElement("li");
  const { ts, event, ...rest } = entry;
  const time = new Date(ts).toLocaleTimeString();
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  li.textContent = `${time} · ${event}${extra}`;
  return li;
}

export function initActivityFeed(listId: string): void {
  const list = document.getElementById(listId);
  if (!(list instanceof HTMLUListElement)) return;

  fetch("/api/activity/recent")
    .then((res) => res.json())
    .then((data: { events: LogEntry[] }) => {
      for (const entry of data.events) list.append(renderLine(entry));
      list.scrollTop = list.scrollHeight;
    })
    .catch(() => {
      const li = document.createElement("li");
      li.className = "error-text";
      li.textContent = "Couldn't load recent activity.";
      list.append(li);
    });

  const source = new EventSource("/api/activity/stream");
  source.onmessage = (ev) => {
    const entry = JSON.parse(ev.data) as LogEntry;
    list.append(renderLine(entry));
    while (list.children.length > 200) list.firstElementChild?.remove();
    list.scrollTop = list.scrollHeight;
  };
}
