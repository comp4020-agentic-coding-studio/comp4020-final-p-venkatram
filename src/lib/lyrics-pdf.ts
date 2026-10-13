// Renders the current lyrics document (plus any comments) to a downloadable
// PDF, entirely client-side — same reasoning as staff-pdf.ts: no spare
// server capacity on a 256MB machine for this, and none is needed. Plain
// jsPDF text layout, no SVG/svg2pdf — there's no graphics here, just lines.
import { jsPDF } from "jspdf";
import type { LyricLine } from "../../shared/lyrics";
import type { LyricsComment } from "./lyrics-comments";
import { savePdfToLibrary } from "./library-save";

const PAGE_WIDTH = 612; // 8.5in at 72pt/in
const PAGE_HEIGHT = 792; // 11in
const MARGIN = 54;
const LINE_HEIGHT = 18;

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : "lyrics";
}

export async function exportLyricsPdf(
  roomId: string,
  roomName: string,
  title: string | null,
  lines: LyricLine[],
  comments: LyricsComment[],
): Promise<void> {
  const pdf = new jsPDF("p", "pt", [PAGE_WIDTH, PAGE_HEIGHT]);
  let y = MARGIN;

  function ensureSpace(next: number): void {
    if (y + next > PAGE_HEIGHT - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(title && title.length > 0 ? title : "Untitled lyrics", MARGIN, y);
  y += LINE_HEIGHT;

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(10);
  pdf.text(`WaveForge — ${roomName || "Untitled room"} · exported ${new Date().toLocaleString()}`, MARGIN, y);
  y += LINE_HEIGHT * 1.5;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  if (lines.length === 0) {
    pdf.text("No lyrics uploaded yet.", MARGIN, y);
    y += LINE_HEIGHT;
  }
  for (const line of lines) {
    ensureSpace(LINE_HEIGHT);
    pdf.text(line.text, MARGIN, y);
    y += LINE_HEIGHT;
  }

  if (comments.length > 0) {
    y += LINE_HEIGHT;
    ensureSpace(LINE_HEIGHT);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("Comments", MARGIN, y);
    y += LINE_HEIGHT;

    pdf.setFontSize(11);
    for (const comment of [...comments].sort((a, b) => a.createdAt - b.createdAt)) {
      const quoted = lines[comment.lineIndex]?.text.slice(comment.startOffset, comment.endOffset) ?? "";
      const header = `${comment.authorName} on "${quoted}":`;
      const body = pdf.splitTextToSize(comment.text, PAGE_WIDTH - MARGIN * 2) as string[];
      ensureSpace(LINE_HEIGHT * (1 + body.length));
      pdf.setFont("helvetica", "bold");
      pdf.text(header, MARGIN, y);
      y += LINE_HEIGHT;
      pdf.setFont("helvetica", "normal");
      for (const bodyLine of body) {
        pdf.text(bodyLine, MARGIN + 12, y);
        y += LINE_HEIGHT;
      }
    }
  }

  const filename = `waveforge-lyrics-${slugify(roomName)}.pdf`;
  pdf.save(filename);
  savePdfToLibrary(roomId, filename, pdf);
}
