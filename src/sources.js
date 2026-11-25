import * as cheerio from 'cheerio';
import { fetchJson, fetchText, robotsAllows } from './http.js';
import { extractFromHtml, sectionsFromWikiText } from './extract.js';

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
    const api = `https://${w.host}/w/api.php?action=query&prop=extracts|info&inprop=url&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(id)}`;
    const data = await fetchJson(api);
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined || !page.extract) { const e = new Error('Page not found.'); e.status = 404; throw e; }
    return { title: page.title, url: page.fullurl, sourceName: w.name, license: w.license, sections: sectionsFromWikiText(page.extract) };
  }
  if (source === 'arxiv') {
    const arxivId = String(id).replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    const [entry] = parseArxiv(xml);
    if (!entry) { const e = new Error('Paper not found.'); e.status = 404; throw e; }
    return { title: entry.title, url: entry.id, sourceName: 'arXiv', license: 'See paper page', authors: entry.authors, sections: [{ heading: 'Abstract', text: entry.summary }] };
  }
  if (source === 'url') return importUrl(url);
  throw badRequest(`Unknown source "${source}".`);
}

export async function importUrl(url) {
  const site = siteForUrl(url);
  if (!site) throw badRequest('Studify only imports pages from open-licensed sites: ' + IMPORT_SITES.map(s => s.domain).join(', ') + '.');
  if (!(await robotsAllows(url))) { const e = new Error(`${site.name} asks bots not to read this page (robots.txt), so Studify will not import it.`); e.status = 403; throw e; }
  const html = await fetchText(url, { accept: 'text/html' });
  const doc = extractFromHtml(html);
  if (!doc.sections.length) throw badRequest('Could not find readable text on that page. Try a lecture-notes or chapter page instead of an index page.');
  return { ...doc, url, sourceName: site.name, license: site.license };
}
