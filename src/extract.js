import * as cheerio from 'cheerio';

const DROP = '.modal,[role=dialog],script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,figure figcaption,.navbox,.reflist,.references,.mw-editsection,.sidebar,.toc,#toc,[role=navigation],[aria-hidden=true],.course-nav,.breadcrumb';

// Turn an HTML page into { title, sections: [{ heading, text }] }.
export function extractFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
  const related = baseUrl ? relatedLinks($, baseUrl) : [];
  const title = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text() || 'Untitled').trim();
  $(DROP).remove();
  const candidates = ['main', 'article', '[role=main]', '#main-content', '#content', '.main-content', 'body'];
  let root = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) { root = el; break; }
  }
  root = root || $('body');

  const sections = [];
  let current = { heading: 'Introduction', text: [] };
  root.find('h1,h2,h3,h4,p,li,dd,blockquote').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (/^h[1-4]$/.test(tag)) {
      if (current.text.length) sections.push(current);
      current = { heading: text, text: [] };
    } else if (tag === 'li') {
      if ($(el).find('p,li').length) return; // avoid duplicating nested content
      if (text.length > 25) current.text.push(text.endsWith('.') ? text : text + '.');
    } else if (text.length > 40) {
      current.text.push(text);
    }
  });
  if (current.text.length) sections.push(current);

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
  return { title: cleanTitle(title), sections: sections.map(s => ({ heading: s.heading, text: s.text.join(' ') })), related };
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
    if (/\.(pdf|zip|mp4|jpg|png)$/i.test(u.pathname) || /download|instructor-insights/i.test(u.pathname)) return;
    seen.add(u.pathname);
    out.push({ title: text, url: u.origin + u.pathname });
  });
  return out.slice(0, 25);
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
