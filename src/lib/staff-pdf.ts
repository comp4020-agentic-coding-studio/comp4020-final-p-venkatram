// Renders the current composition to a downloadable PDF, entirely
// client-side (jsPDF + svg2pdf.js — no server involvement, same reasoning as
// recorder.ts: the server has no spare capacity on a 256MB machine for this
// kind of work, and doesn't need any).
//
// This builds its own plain black-on-white SVG rather than reusing
// composition-staff.ts's live, theme-colored one: a print document shouldn't
// follow the dark/light toggle, and it has no click targets or playhead to
// carry over. The geometry constants are deliberately kept in sync by hand
// with composition-staff.ts, not shared, since the two files draw for very
// different purposes (interactive vs. print).
//
// Text is kept to plain ASCII on purpose: svg2pdf.js vectorizes shapes
// (lines, ellipses, paths) perfectly, but PDF text relies on fonts jsPDF
// actually has — the Unicode clef (𝄞) and sharp (♯) glyphs the live staff
// uses aren't guaranteed to exist in jsPDF's built-in fonts. "Treble" and
// "#" carry the same information without that risk.
import { jsPDF } from "jspdf";
import "svg2pdf.js";
import { type Cell, GRID_STEPS } from "../../shared/grid";
import { diatonicIndexToY, pitchToStaffNote } from "./staff-notation";
import { savePdfToLibrary } from "./library-save";

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP_WIDTH = 68;
const NOTE_AREA_X = 40;
const HALF_LINE_SPACING = 16;
const TOP_LINE_Y = 0;
const BOTTOM_LINE_Y = TOP_LINE_Y + 4 * HALF_LINE_SPACING * 2;
const NOTEHEAD_RX = 11;
const NOTEHEAD_RY = 8.6;
const STEM_HEIGHT = 54;
const TOP_MARGIN = 150; // room for the title plus ledger lines/stems above the staff
const BOTTOM_MARGIN = 90;
const LEFT_MARGIN = 24;
const RIGHT_MARGIN = 40;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function text(x: number, y: number, size: number, content: string, extra: Record<string, string> = {}): SVGTextElement {
  const el = svgEl("text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("font-size", String(size));
  el.setAttribute("font-family", "helvetica");
  el.setAttribute("fill", "#000000");
  for (const [key, value] of Object.entries(extra)) el.setAttribute(key, value);
  el.textContent = content;
  return el;
}

function buildExportSvg(roomName: string, cells: Cell[], bpm: number): SVGSVGElement {
  const width = LEFT_MARGIN + NOTE_AREA_X + GRID_STEPS * STEP_WIDTH + RIGHT_MARGIN;
  const height = TOP_MARGIN + (BOTTOM_LINE_Y - TOP_LINE_Y) + BOTTOM_MARGIN;
  const staffOriginY = TOP_MARGIN;

  const svg = svgEl("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const background = svgEl("rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", "#ffffff");
  svg.append(background);

  svg.append(text(LEFT_MARGIN, 42, 26, `WaveForge — ${roomName || "Untitled room"}`, { "font-weight": "bold" }));
  svg.append(
    text(LEFT_MARGIN, 66, 13, `${bpm} bpm · exported ${new Date().toLocaleString()}`, {
      fill: "#555555",
      "font-style": "italic",
    }),
  );

  const staff = svgEl("g");
  staff.setAttribute("transform", `translate(${LEFT_MARGIN}, ${staffOriginY})`);

  for (let line = 0; line < 5; line++) {
    const y = TOP_LINE_Y + line * HALF_LINE_SPACING * 2;
    const el = svgEl("line");
    el.setAttribute("x1", String(NOTE_AREA_X - 12));
    el.setAttribute("x2", String(NOTE_AREA_X + GRID_STEPS * STEP_WIDTH));
    el.setAttribute("y1", String(y));
    el.setAttribute("y2", String(y));
    el.setAttribute("stroke", "#000000");
    el.setAttribute("stroke-width", "1.5");
    staff.append(el);
  }

  staff.append(text(0, BOTTOM_LINE_Y - 20, 16, "Treble", { "font-style": "italic" }));

  if (cells.length === 0) {
    staff.append(text(NOTE_AREA_X, BOTTOM_LINE_Y + 50, 14, "No notes placed yet.", { fill: "#777777" }));
  }

  for (const [step, pitch, duration] of cells) {
    const note = pitchToStaffNote(pitch, duration);
    const x = NOTE_AREA_X + (step + 0.5) * STEP_WIDTH;
    const y = diatonicIndexToY(note.diatonicIndex, BOTTOM_LINE_Y, HALF_LINE_SPACING);

    for (let k = 1; k <= note.ledgerLines; k++) {
      const ledgerY =
        note.ledgerSide === "below" ? BOTTOM_LINE_Y + k * HALF_LINE_SPACING * 2 : TOP_LINE_Y - k * HALF_LINE_SPACING * 2;
      const ledger = svgEl("line");
      ledger.setAttribute("x1", String(x - NOTEHEAD_RX - 4));
      ledger.setAttribute("x2", String(x + NOTEHEAD_RX + 4));
      ledger.setAttribute("y1", String(ledgerY));
      ledger.setAttribute("y2", String(ledgerY));
      ledger.setAttribute("stroke", "#000000");
      ledger.setAttribute("stroke-width", "1.5");
      staff.append(ledger);
    }

    if (note.sharp) {
      staff.append(text(x - NOTEHEAD_RX - 16, y + 5, 18, "#"));
    }

    if (note.glyph.stem) {
      const stemX = x + NOTEHEAD_RX - 1;
      const stem = svgEl("line");
      stem.setAttribute("x1", String(stemX));
      stem.setAttribute("x2", String(stemX));
      stem.setAttribute("y1", String(y));
      stem.setAttribute("y2", String(y - STEM_HEIGHT));
      stem.setAttribute("stroke", "#000000");
      stem.setAttribute("stroke-width", "2");
      staff.append(stem);

      for (let f = 0; f < note.glyph.flags; f++) {
        const flagY = y - STEM_HEIGHT + f * 14;
        const flag = svgEl("path");
        flag.setAttribute("d", `M ${stemX} ${flagY} q 16 4 16 20 q -8 -8 -16 -6 Z`);
        flag.setAttribute("fill", "#000000");
        staff.append(flag);
      }
    }

    const notehead = svgEl("ellipse");
    notehead.setAttribute("cx", String(x));
    notehead.setAttribute("cy", String(y));
    notehead.setAttribute("rx", String(NOTEHEAD_RX));
    notehead.setAttribute("ry", String(NOTEHEAD_RY));
    if (note.glyph.open) {
      notehead.setAttribute("fill", "#ffffff");
      notehead.setAttribute("stroke", "#000000");
      notehead.setAttribute("stroke-width", "2.5");
    } else {
      notehead.setAttribute("fill", "#000000");
    }
    staff.append(notehead);
  }

  svg.append(staff);
  return svg;
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : "composition";
}

export async function exportCompositionPdf(roomId: string, roomName: string, cells: Cell[], bpm: number): Promise<void> {
  const svg = buildExportSvg(roomName, cells, bpm);
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));

  // svg2pdf.js needs the element actually rendered (for text/layout
  // measurement) — attached off-screen rather than just held in memory.
  svg.style.position = "absolute";
  svg.style.left = "-99999px";
  svg.style.top = "0";
  document.body.append(svg);

  try {
    const pdf = new jsPDF(width > height ? "l" : "p", "pt", [width, height]);
    await pdf.svg(svg, { x: 0, y: 0, width, height });
    const filename = `waveforge-${slugify(roomName)}.pdf`;
    pdf.save(filename);
    savePdfToLibrary(roomId, filename, pdf);
  } finally {
    svg.remove();
  }
}
