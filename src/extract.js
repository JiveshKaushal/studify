import * as cheerio from 'cheerio';
import { MathStore, tokenizeHtmlMath, tokenizeTextMath } from './math.js';

const DROP = '.modal,[role=dialog],sup.reference,sup.mw-ref,.mw-references-wrap,.hatnote,.navbox,.metadata,.mw-empty-elt,.noprint,.infobox,table.sidebar,.shortdescription,link,script,style,noscript,nav,header,footer,aside,form,iframe,svg,.navbox,.reflist,.references,.mw-editsection,.sidebar,.toc,#toc,[role=navigation],[aria-hidden=true],.course-nav,.breadcrumb';

const SKIP_HEADINGS = /^(see also|references|external links|further reading|notes|bibliography|sources|citations|footnotes|notes and references|works cited)$/i;

// Turn an HTML page into { title, sections: [{ heading, text }], figures, math, related }.
// Formulas become ⟦mN⟧ tokens (see math.js); figures keep the section they appeared in.
export function extractFromHtml(html, baseUrl, { title: givenTitle } = {}) {
  const $ = cheerio.load(html);
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
  const related = baseUrl ? relatedLinks($, baseUrl) : [];
  const title = givenTitle || ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text() || 'Untitled').trim();
  $(DROP).remove();
  const candidates = ['main', 'article', '[role=main]', '#main-content', '#content', '.main-content', 'body'];
  let root = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) { root = el; break; }
  }
  root = root || $('body');

  const store = new MathStore();
  tokenizeHtmlMath($, root, store);

  const sections = [];
  const figures = [];
  const formulaContext = new Map(); // formula id -> { section, context }
  let current = { heading: 'Introduction', text: [] };
  let skipping = false;
  const clean = el => tokenizeTextMath($(el).text(), store).replace(/[\u2060\u200b\u00ad]/g, '').replace(/\s+/g, ' ').trim();
  const noteFormulas = text => {
    for (const m of text.matchAll(/⟦m(\d+)⟧/g)) {
      if (formulaContext.has(+m[1])) continue;
      // Inline formula: the sentence around it. Formula on its own line: the text just before it.
      const prose = text.replace(/⟦m\d+⟧/g, '').replace(/[\s\d.,()]+/g, ' ').trim();
      const context = prose.length > 40 ? text : (current.text.at(-1) || '');
      formulaContext.set(+m[1], { section: current.heading, context: context.slice(-400) });
    }
  };

  root.find('h1,h2,h3,h4,p,li,dd,blockquote,[data-type="equation"],.equation,figure,[typeof*="mw:File/Thumb"],[typeof*="mw:File/Frame"]').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName.toLowerCase();
    if ($el.closest('figure').length && tag !== 'figure') return;
    if (tag !== 'div' && $el.closest('[data-type="equation"],.equation').length) return;
    if (tag === 'figure' || /mw:File/.test($el.attr('typeof') || '')) {
      if (!skipping) { const f = figureFrom($, $el, baseUrl, current.heading); if (f) figures.push(f); }
      return;
    }
    if (/^h[1-4]$/.test(tag)) {
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (current.text.length) sections.push(current);
      current = { heading: text, text: [] };
      skipping = SKIP_HEADINGS.test(text);
      return;
    }
    if (skipping) return;
    const text = clean(el);
    if (!text) return;
    const plain = text.replace(/⟦m\d+⟧/g, 'x');
    if (tag === 'li') {
      if ($el.find('p,li').length) return; // avoid duplicating nested content
      if (plain.length > 25) { noteFormulas(text); current.text.push(/[.!?:]$/.test(text) ? text : text + '.'); }
    } else if (tag === 'dd' || tag === 'div' || plain.length <= 40) {
      // Short lines and indented blocks often hold a displayed formula: keep the formula, not the line.
      if (/⟦m\d+⟧/.test(text)) { noteFormulas(text); current.text.push(text); }
    } else {
      noteFormulas(text); current.text.push(text);
    }
  });
  if (current.text.length && !skipping) sections.push(current);

  // Some pages (e.g. MIT OCW course home pages) keep their text in <div>s, not <p>s.
  if (!sections.length) {
    const blocks = [];
    root.find('div,span,section,td').each((_, el) => {
      const own = $(el).clone().children('div,section,ul,ol,table').remove().end().text().replace(/\s+/g, ' ').trim();
      if (own.length > 80 && looksLikeProse(own) && !blocks.some(b => b.includes(own))) blocks.push(own);
    });
    if (!blocks.length && description.length > 80) blocks.push(description);
    if (blocks.length) sections.push({ heading: 'Introduction', text: blocks });
  }

  const math = store.items.map((m, i) => ({ ...m, ...(formulaContext.get(i) || {}) }));
  return {
    title: cleanTitle(title),
    sections: sections.map(s => ({ heading: s.heading, text: s.text.join(' ') })),
    figures: dedupeFigures(figures).slice(0, 12),
    math,
    related,
  };
}

function absolutize(src, baseUrl) {
  if (!src) return null;
  try { return new URL(src.startsWith('//') ? 'https:' + src : src, baseUrl || 'https://example.org').href; } catch { return null; }
}

function figureFrom($, $fig, baseUrl, section) {
  const img = $fig.find('img').first();
  if (!img.length) return null;
  const w = Number(img.attr('width') || img.attr('data-file-width') || 0);
  const h = Number(img.attr('height') || img.attr('data-file-height') || 0);
  if ((w && w < 120) || (h && h < 80)) return null; // icons and bullets
  const src = absolutize(img.attr('src') || img.attr('data-src'), baseUrl);
  if (!src || !/^https:/.test(src)) return null;
  const caption = ($fig.find('figcaption').first().text() || img.attr('alt') || $fig.find('[data-alt]').attr('data-alt') || '').replace(/\s+/g, ' ').trim();
  const fileLink = $fig.find('a.mw-file-description, a[href*="File:"]').attr('href');
  const credit = absolutize(fileLink, baseUrl) || baseUrl;
  return { src, caption: caption.slice(0, 400), section, credit, width: w || undefined, height: h || undefined };
}

function dedupeFigures(figs) {
  const seen = new Set();
  return figs.filter(f => { const k = f.src.replace(/\?.*$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Real sentences, not menus: ends like a sentence and is not mostly Capitalised Words.
function looksLikeProse(t) {
  const ws = t.split(/\s+/);
  const caps = ws.filter(w => /^[A-Z]/.test(w)).length;
  return ws.length >= 12 && /[.!?]["')]?$/.test(t) && caps / ws.length < 0.4;
}

function cleanTitle(t) {
  // "Syllabus | Principles of Microeconomics | Economics | MIT OpenCourseWare" -> "Syllabus | Principles of Microeconomics"
  const parts = t.split(/\s+[|\u2013\u2014-]\s+/).map(x => x.trim()).filter(Boolean);
  const drop = /^(MIT OpenCourseWare|OpenStax|LibreTexts|OpenLearn.*|Open University|Wikipedia|Economics|Mathematics|Physics|Biology|Chemistry)$/i;
  const kept = parts.filter((x, i) => i === 0 || !drop.test(x));
  return [...new Set(kept)].slice(0, 2).join(' | ') || t;
}

// Links to other pages of the same course/book, so users can make notes from them next.
function relatedLinks($, baseUrl) {
  const base = new URL(baseUrl);
  const m = base.pathname.match(/^\/(courses\/[^/]+|books\/[^/]+)\//);
  if (!m) return [];
  const prefix = '/' + m[1] + '/';
  const seen = new Set([base.pathname]);
  const out = [];
  $('a[href]').each((_, a) => {
    let u;
    try { u = new URL($(a).attr('href'), base); } catch { return; }
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    if (u.hostname !== base.hostname || !u.pathname.startsWith(prefix) || seen.has(u.pathname) || !text || text.length > 90) return;
    if (/^(previous|next|prev|back|home|skip to .*|https?:\/\/.*)$/i.test(text)) return;
    if (/\.(zip|mp4|jpg|png|srt|vtt)$/i.test(u.pathname) || /download|instructor-insights|video_galleries/i.test(u.pathname)) return;
    if (/^(pdf|zip|mp4)\b.*\b(kb|mb)$/i.test(text)) return; // "pdf 119 kB" duplicates the resource link next to it
    seen.add(u.pathname);
    out.push({ title: /\.pdf$/i.test(u.pathname) && !/pdf/i.test(text) ? `${text} (PDF)` : text, url: u.origin + u.pathname });
  });
  return out.slice(0, 40);
}

// MediaWiki plain-text extracts use "== Heading ==" lines.
export function sectionsFromWikiText(extract) {
  const sections = [];
  let current = { heading: 'Introduction', lines: [] };
  for (const line of extract.split('\n')) {
    const m = line.match(/^(={2,6})\s*(.+?)\s*\1$/);
    if (m) {
      if (current.lines.length) sections.push(current);
      current = { heading: m[2], lines: [] };
    } else if (line.trim()) {
      current.lines.push(line.trim());
    }
  }
  if (current.lines.length) sections.push(current);
  const skip = /^(see also|references|external links|further reading|notes|bibliography|sources|citations|footnotes)$/i;
  return sections.filter(s => !skip.test(s.heading)).map(s => ({ heading: s.heading, text: s.lines.join(' ') }));
}
