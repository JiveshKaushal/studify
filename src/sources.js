import * as cheerio from 'cheerio';
import { fetchJson, fetchText, fetchBuffer, robotsAllows } from './http.js';
import { extractFromPdf, pagesToDoc, MAX_PDF_BYTES } from './pdf.js';
import { extractFromHtml, sectionsFromWikiText } from './extract.js';
import { MathStore } from './math.js';

// Sources with a public API that Studify can search directly.
const WIKIS = {
  wikipedia: { name: 'Wikipedia', host: 'en.wikipedia.org', license: 'CC BY-SA 4.0' },
  simplewiki: { name: 'Simple English Wikipedia', host: 'simple.wikipedia.org', license: 'CC BY-SA 4.0' },
  wikibooks: { name: 'Wikibooks', host: 'en.wikibooks.org', license: 'CC BY-SA 4.0' },
};

// Open-licensed sites whose pages can be imported by URL (robots.txt is checked first).
export const IMPORT_SITES = [
  { domain: 'ocw.mit.edu', name: 'MIT OpenCourseWare', license: 'CC BY-NC-SA 4.0', searchUrl: q => `https://ocw.mit.edu/search/?q=${encodeURIComponent(q)}` },
  { domain: 'openstax.org', name: 'OpenStax', license: 'CC BY 4.0', searchUrl: q => `https://openstax.org/search?q=${encodeURIComponent(q)}` },
  { domain: 'libretexts.org', name: 'LibreTexts', license: 'CC BY-NC-SA (varies by page)', searchUrl: q => `https://libretexts.org/search?q=${encodeURIComponent(q)}` },
  { domain: 'open.edu', name: 'OpenLearn (The Open University)', license: 'CC BY-NC-SA 4.0', searchUrl: q => `https://www.open.edu/openlearn/search-results?keys=${encodeURIComponent(q)}` },
  { domain: 'wikipedia.org', name: 'Wikipedia', license: 'CC BY-SA 4.0' },
  { domain: 'wikibooks.org', name: 'Wikibooks', license: 'CC BY-SA 4.0' },
  { domain: 'wikiversity.org', name: 'Wikiversity', license: 'CC BY-SA 4.0' },
  { domain: 'arxiv.org', name: 'arXiv', license: 'Varies per paper (abstracts are free to read)' },
];

export function listSources() {
  return {
    searchable: [
      ...Object.entries(WIKIS).map(([id, w]) => ({ id, name: w.name, license: w.license })),
      { id: 'arxiv', name: 'arXiv (paper abstracts)', license: 'Varies per paper' },
    ],
    importable: IMPORT_SITES.map(s => ({ domain: s.domain, name: s.name, license: s.license })),
  };
}

export function externalSearchLinks(q) {
  return IMPORT_SITES.filter(s => s.searchUrl).map(s => ({ name: s.name, url: s.searchUrl(q) }));
}

export function siteForUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return IMPORT_SITES.find(s => u.hostname === s.domain || u.hostname.endsWith('.' + s.domain)) || null;
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

export async function search(source, q) {
  if (!q || !q.trim()) throw badRequest('Type a topic to search for.');
  if (WIKIS[source]) {
    const { host } = WIKIS[source];
    const url = `https://${host}/w/api.php?action=query&list=search&format=json&srlimit=8&srprop=snippet&srsearch=${encodeURIComponent(q)}`;
    const data = await fetchJson(url);
    return (data.query?.search || []).map(r => ({
      source, id: r.title, title: r.title,
      snippet: cheerio.load(r.snippet).text(),
      url: `https://${host}/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    }));
  }
  if (source === 'arxiv') {
    const xml = await fetchText(`https://export.arxiv.org/api/query?max_results=8&search_query=all:${encodeURIComponent(q)}`);
    return parseArxiv(xml).map(e => ({ source, id: e.id, title: e.title, snippet: e.summary.slice(0, 220) + '…', url: e.id }));
  }
  throw badRequest(`Unknown source "${source}".`);
}

export function parseArxiv(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('entry').map((_, el) => ({
    id: $(el).children('id').text().trim(),
    title: $(el).children('title').text().replace(/\s+/g, ' ').trim(),
    summary: $(el).children('summary').text().replace(/\s+/g, ' ').trim(),
    authors: $(el).find('author > name').map((__, a) => $(a).text()).get(),
  })).get();
}

// Returns a document: { title, url, sourceName, license, sections: [{heading, text}] }
export async function getDocument({ source, id, url }) {
  if (WIKIS[source]) {
    const w = WIKIS[source];
    const pageUrl = `https://${w.host}/wiki/${encodeURIComponent(String(id).replace(/ /g, '_'))}`;
    try {
      // Rendered page HTML keeps formulas (with their LaTeX) and figures with captions.
      const html = await fetchText(`https://${w.host}/api/rest_v1/page/html/${encodeURIComponent(String(id).replace(/ /g, '_'))}?redirect=true`, { accept: 'text/html' });
      const doc = extractFromHtml(html, pageUrl, { title: String(id) });
      if (doc.sections.length) return { ...doc, related: [], url: pageUrl, sourceName: w.name, license: w.license };
    } catch {
      // Fall back to the plain-text API below (no formulas or pictures); it also reports missing pages.
    }
    const api = `https://${w.host}/w/api.php?action=query&prop=extracts|info&inprop=url&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(id)}`;
    const data = await fetchJson(api);
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined || !page.extract) { const e = new Error('Page not found.'); e.status = 404; throw e; }
    return { title: page.title, url: page.fullurl, sourceName: w.name, license: w.license, sections: sectionsFromWikiText(page.extract), figures: [], math: [] };
  }
  if (source === 'arxiv') {
    const arxivId = String(id).replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    const [entry] = parseArxiv(xml);
    if (!entry) { const e = new Error('Paper not found.'); e.status = 404; throw e; }
    // Abstracts write LaTeX between $ signs.
    const store = new MathStore();
    const text = entry.summary.replace(/\$\$([^$]+)\$\$|\$([^$]{1,200})\$/g, (_, a, b) => store.add({ tex: (a || b).trim(), display: Boolean(a) }));
    const math = store.items.map(m => ({ ...m, section: 'Abstract' }));
    return { title: entry.title, url: entry.id, sourceName: 'arXiv', license: 'See paper page', authors: entry.authors, sections: [{ heading: 'Abstract', text }], figures: [], math };
  }
  if (source === 'url') return importUrl(url);
  throw badRequest(`Unknown source "${source}".`);
}

const isPdfBuffer = buf => buf.subarray(0, 5).toString('latin1') === '%PDF-';

// Checks that a URL is on an allowed site and that its robots.txt lets Studify read it.
export async function checkImportable(url) {
  const site = siteForUrl(url);
  if (!site) throw badRequest('Studify only imports pages from open-licensed sites: ' + IMPORT_SITES.map(s => s.domain).join(', ') + '.');
  if (!(await robotsAllows(url))) { const e = new Error(`${site.name} asks bots not to read this page (robots.txt), so Studify will not import it.`); e.status = 403; throw e; }
  return site;
}

// Fetches a PDF from an allowed site (used for notes and for the browser's page previews).
export async function fetchPdf(url) {
  await checkImportable(url);
  const { buffer } = await fetchBuffer(url, { maxBytes: MAX_PDF_BYTES });
  if (!isPdfBuffer(buffer)) throw badRequest('That link is not a PDF file.');
  return buffer;
}

async function importPdf(url, site, titleHint) {
  const buffer = await fetchPdf(url);
  const pdf = await extractFromPdf(buffer);
  const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.pdf$/i, '').replace(/^[0-9a-f]{32}_/, '')
    .replace(/^lec(?:ture)?[_ -]?0*(\d+)$/i, 'Lecture $1').replace(/[_-]+/g, ' ');
  const words = pdf.sections.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  const notices = [];
  if (pdf.pagesRead < pdf.pages) notices.push(`Only the first ${pdf.pagesRead} of ${pdf.pages} pages were read.`);
  if (pdf.scanned) notices.push('This PDF is scanned (pictures of pages), so it has no text to read directly. Use “Read with OCR” below to read the pages in your browser.');
  else if (words < 120) notices.push(pdf.visualPages.length ? 'This PDF is mostly figures and formulas, so there is little text to summarise. See the page previews below.' : 'Studify could not find much text in this PDF. It may be a scanned document.');
  return {
    title: titleHint || pdf.title || fileName,
    sections: pdf.sections.length ? pdf.sections : [{ heading: 'Introduction', text: '' }],
    figures: [],
    math: [],
    related: [],
    url,
    sourceName: site.name,
    license: site.license,
    pdf: { url, pages: pdf.pages, visualPages: pdf.scanned ? [] : pdf.visualPages, scanned: pdf.scanned || undefined },
    notice: notices.join(' ') || undefined,
  };
}

export async function importUrl(url) {
  const site = await checkImportable(url);
  if (/\.pdf($|[?#])/i.test(new URL(url).pathname + new URL(url).search)) return importPdf(url, site);

  const html = await fetchText(url, { accept: 'text/html' });
  const doc = extractFromHtml(html, url);
  const words = doc.sections.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  // MIT OCW "resource" pages wrap a single PDF: read the PDF instead.
  if (words < 150) {
    const $ = cheerio.load(html);
    const pdfHref = $('main a[href$=".pdf"], a.download-file[href$=".pdf"], a[href$=".pdf"]').first().attr('href');
    if (pdfHref && /\/resources\//.test(new URL(url).pathname)) {
      const pdfUrl = new URL(pdfHref, url).href;
      if (siteForUrl(pdfUrl)) return importPdf(pdfUrl, site, doc.title.split(' | ')[0]);
    }
  }
  if (!doc.sections.length) throw badRequest('Could not find readable text on that page. Try a lecture-notes or chapter page instead of an index page.');
  if (words < 150 && doc.related.length) doc.notice = 'This looks like an overview page with little text. Pick a page below (lecture notes, readings, chapters) for fuller notes.';
  return { ...doc, url, sourceName: site.name, license: site.license };
}

// Notes from text that the browser read off a scanned PDF with OCR.
// pages: [{ number, lines: [{ text, size, y }] }] — size is the line height in pixels.
export function documentFromOcr({ url, title, pages, totalPages }) {
  const site = siteForUrl(url || '');
  if (!site) throw badRequest('Unknown PDF source.');
  if (!Array.isArray(pages) || !pages.length) throw badRequest('No OCR text was sent.');
  if (pages.length > 60) throw badRequest('Too many pages.');
  const clean = pages.map(pg => {
    const height = Number(pg.height) || 0;
    const lines = (Array.isArray(pg.lines) ? pg.lines : []).slice(0, 400)
      .map(l => ({ text: cleanOcrLine(String(l.text || '')), size: Math.max(1, Math.min(500, Number(l.size) || 10)), y: Number(l.y) || 0 }))
      .filter(l => l.text)
      // OCR misreads running headers/footers a little differently on every page, so drop short lines at the very top or bottom.
      .filter(l => !(height && l.text.length < 50 && (-l.y < height * 0.1 || -l.y > height * 0.93)));
    return { number: Number(pg.number) || 0, drawing: 0, images: 1, lines };
  });
  const pdf = pagesToDoc(clean, { title: '', numPages: Number(totalPages) || clean.length, pageCount: clean.length });
  // Scanners name files like "scan0001": prefer the largest heading in the text.
  if (pdf.title && (!title || /^[\w-]+$/.test(String(title)) && /[_\d]/.test(String(title)))) title = pdf.title;
  const read = clean.length;
  const notices = ['Text read with OCR, so expect some mistakes (especially in formulas).'];
  if (totalPages > read) notices.push(`Read ${read} of ${totalPages} pages.`);
  return {
    title: String(title || pdf.title || 'Scanned PDF').slice(0, 200),
    sections: pdf.sections.length ? pdf.sections : [{ heading: 'Introduction', text: '' }],
    figures: [], math: [], related: [],
    url, sourceName: site.name, license: site.license,
    pdf: { url, pages: Number(totalPages) || read, visualPages: pdf.visualPages, ocr: true },
    notice: notices.join(' '),
  };
}

// OCR reads bullet dots as "e", "E", "®", "°" and similar: turn them back into bullets.
function cleanOcrLine(t) {
  return t.replace(/\s+/g, ' ').trim().slice(0, 500)
    .replace(/^(?:[eEoO0®°©«»·•*]|\(\s*\)|\.)\s+(?=[A-Z("“])/, '• ')
    .replace(/\s[|_]\s/g, ' ');
}
