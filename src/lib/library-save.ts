// Shared by every PDF export (lyrics, composition) — turns a jsPDF instance
// into base64 bytes and posts it to the room's Library
// (server/routes/library.ts), so an exported document shows up there for
// reference, not just as a one-off local download.
import type { jsPDF } from "jspdf";

export function savePdfToLibrary(roomId: string, title: string, pdf: jsPDF): void {
  const dataUri = pdf.output("datauristring");
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  void fetch(`/api/rooms/${encodeURIComponent(roomId)}/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ title, dataBase64: base64 }),
  }).catch(() => {
    // the local download already happened; a failed library save just
    // means this document isn't listed for reference, nothing to reconcile
  });
}
