import * as cheerio from 'cheerio';

const DROP = 'script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,figure figcaption,.navbox,.reflist,.references,.mw-editsection,.sidebar,.toc,#toc,[role=navigation],[aria-hidden=true],.course-nav,.breadcrumb';

// Turn an HTML page into { title, sections: [{ heading, text }] }.
export function extractFromHtml(html) {
  const $ = cheerio.load(html);
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
  return { title, sections: sections.map(s => ({ heading: s.heading, text: s.text.join(' ') })) };
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
