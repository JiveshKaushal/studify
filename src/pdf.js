// Reads lecture-note PDFs into the same { title, sections } shape as web pages.
// PDF maths is just positioned glyphs, so formulas can't be recovered as LaTeX; instead the
// pages that hold formulas or figures are listed so the browser can show them as page previews.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DRAW_OPS = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'constructPath', 'stroke', 'fill', 'eoFill', 'fillStroke', 'closeStroke'].map(k => OPS[k]).filter(v => v !== undefined));

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 60;

const MATHY = /[=≤≥≠≈∫∑∏√∞±×÷→⇒∂∆∇πθλμσαβγδε^]|\b(lim|sin|cos|tan|log|ln|dx|dy)\b/g;

function lineSize(items) {
  return Math.max(...items.map(i => Math.round(Math.hypot(i.transform[2], i.transform[3]) * 2) / 2));
}

// Group text items into visual lines (same baseline), left to right.
function toLines(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform[5];
    let line = lines.find(l => Math.abs(l.y - y) < 2.5);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = '';
    let lastEnd = null;
    for (const it of l.items) {
      const x = it.transform[4];
      // Add a space where pdf.js left a visible gap between pieces of text.
      if (lastEnd !== null && x - lastEnd > 1.5 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      lastEnd = x + (it.width || 0);
    }
    l.text = text.replace(/\s+/g, ' ').trim();
    l.size = lineSize(l.items.filter(i => i.str.trim()));
  }
  return lines.filter(l => l.text).sort((a, b) => b.y - a.y);
}

const isCoverPage = text => /For information about citing these materials|ocw\.mit\.edu\/terms/i.test(text) && text.length < 600;

async function readPages(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const meta = await pdf.getMetadata().catch(() => null);
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    const pages = [];
    for (let p = 1; p <= pageCount; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const ops = await page.getOperatorList().catch(() => null);
      // Count drawing and image operations: a page full of them is usually a figure or a graph.
      let drawing = 0;
      if (ops) for (const fn of ops.fnArray) if (DRAW_OPS.has(fn)) drawing++;
      pages.push({ number: p, lines: toLines(tc.items), drawing });
      page.cleanup();
    }
    return { pages, numPages: pdf.numPages, pageCount, title: (meta?.info?.Title || '').trim() };
  } finally {
    await task.destroy();
  }
}

export async function extractFromPdf(buffer) {
  const { pages, numPages, pageCount, title } = await readPages(buffer);

  // Running headers/footers repeat on most pages; page numbers are bare digits.
  const repeats = new Map();
  for (const pg of pages) for (const t of new Set(pg.lines.map(l => l.text.replace(/\d+/g, '#')))) repeats.set(t, (repeats.get(t) || 0) + 1);
  const boiler = t => /^\d{1,3}$/.test(t) || (pages.length >= 4 && repeats.get(t.replace(/\d+/g, '#')) >= Math.max(3, pages.length * 0.5));

  const sizes = new Map();
  for (const pg of pages) for (const l of pg.lines) if (!boiler(l.text)) sizes.set(l.size, (sizes.get(l.size) || 0) + l.text.length);
  const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;

  // Title: the largest text on the first content pages (joined if it wraps onto two lines).
  let bigTitle = '';
  const firstPages = pages.filter(pg => !isCoverPage(pg.lines.map(l => l.text).join(' '))).slice(0, 2);
  const candidates = firstPages.flatMap(pg => pg.lines.filter(l => !boiler(l.text) && /[A-Za-z]{3}/.test(l.text)));
  const top = Math.max(0, ...candidates.map(l => l.size));
  if (top >= body * 1.3) {
    const big = candidates.filter(l => l.size === top);
    bigTitle = big.slice(0, 3).map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
    if (bigTitle.length > 120 || big.length > 3) bigTitle = big[0].text;
  }

  const sections = [];
  const visualPages = [];
  let current = { heading: 'Introduction', text: [] };
  let para = '';
  const flush = () => { if (para.trim()) current.text.push(para.trim()); para = ''; };

  for (const pg of pages) {
    const pageText = pg.lines.map(l => l.text).join(' ');
    if (isCoverPage(pageText)) continue;
    const content = pg.lines.filter(l => !boiler(l.text));
    const chars = content.reduce((a, l) => a + l.text.length, 0);
    const mathHits = (pageText.match(MATHY) || []).length;
    const figureCaption = content.find(l => /^(figure|fig\.)\s*[\d-]+/i.test(l.text));
    if (figureCaption || mathHits >= 8 || (pg.drawing > 40 && chars < 1200)) {
      visualPages.push({ page: pg.number, reason: figureCaption ? 'figure' : mathHits >= 8 ? 'formulas' : 'diagram', label: figureCaption?.text.slice(0, 120) });
    }
    for (const l of content) {
      const t = l.text;
      if (/^(figure|fig\.)\s*[\d-]+/i.test(t)) { flush(); continue; } // captions are shown with the page previews
      const shortLine = t.length < 90;
      const isHeading = l.size >= body * 1.15 && shortLine && /[A-Za-z]{3}/.test(t) && !/[.,;]$/.test(t);
      if (isHeading) {
        flush();
        if (current.text.length) sections.push(current);
        // "Example 1. f (x) =" -> "Example 1": drop formula pieces from headings.
        const heading = t.replace(/^[A-Z0-9]{1,3}[.)]\s+(?=[A-Z])/, '').replace(/[.:]?\s+[^A-Za-z]*\b[a-z]?\s*\(?[a-z]\)?\s*=.*$/, '').replace(/[\s:=]+$/, '');
        current = { heading: heading || t, text: [] };
        continue;
      }
      if (/^[•●▪◦∗*–-]\s*/.test(t)) {
        // Bullet: its own sentence.
        flush();
        para = t.replace(/^[•●▪◦∗*–-]\s*/, '');
        if (!/[.!?:]$/.test(para)) para += '.';
        flush();
        continue;
      }
      // Lines with few letters are usually pieces of formulas or graph labels.
      const letters = (t.match(/[A-Za-z]/g) || []).length;
      if (letters < t.length * 0.5 || letters < 4) { flush(); continue; }
      // Short unpunctuated lines outside a paragraph are graph labels or stray formula text.
      if (!para && t.length < 28 && !/[.!?:]$/.test(t)) continue;
      para = para.endsWith('-') ? para.slice(0, -1) + t : (para ? para + ' ' + t : t);
      if (/[.!?]$/.test(t) && t.length < 60) flush(); // short line ending a sentence: end of paragraph
    }
    flush();
  }
  if (current.text.length) sections.push(current);

  return {
    // Ignore auto-generated metadata titles like "Microsoft Word - lec1.doc".
    title: title && !/^(microsoft|untitled|document\d*$)|\.(docx?|tex|dvi)$/i.test(title) ? title : bigTitle,
    sections: sections.map(s => ({ heading: s.heading, text: s.text.join(' ') })).filter(s => s.text.length > 40),
    pages: numPages,
    pagesRead: pageCount,
    visualPages: visualPages.slice(0, 12),
  };
}
