import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { WIKI_EXTRACT, OCW_HTML } from './fixtures.js';

// Stub outbound fetches so tests run offline; the app itself uses global fetch.
const realFetch = globalThis.fetch;
let server, base;
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, opts);
    const reply = (body, status = 200) => new Response(body, { status });
    if (u.includes('list=search')) return reply(JSON.stringify({ query: { search: [{ title: 'Photosynthesis', snippet: 'process used by <span class="searchmatch">plants</span>' }] } }));
    if (u.includes('prop=extracts')) return reply(JSON.stringify({ query: { pages: { 1: { title: 'Photosynthesis', fullurl: 'https://en.wikipedia.org/wiki/Photosynthesis', extract: WIKI_EXTRACT } } } }));
    if (u === 'https://ocw.mit.edu/robots.txt') return reply('User-agent: *\nDisallow: /search/');
    if (u.startsWith('https://ocw.mit.edu/courses/')) return reply(OCW_HTML);
    return reply('not found', 404);
  };
});
after(() => { globalThis.fetch = realFetch; server.close(); });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('search returns cleaned results and external links', async () => {
  const r = await (await fetch(`${base}/api/search?source=wikipedia&q=plants`)).json();
  assert.equal(r.results[0].title, 'Photosynthesis');
  assert.equal(r.results[0].snippet, 'process used by plants');
  assert.ok(r.elsewhere.some(l => l.url.startsWith('https://ocw.mit.edu/search/?q=plants')));
});

test('notes from Wikipedia (offline summarizer)', async () => {
  const res = await post('/api/notes', { source: 'wikipedia', id: 'Photosynthesis' });
  assert.equal(res.status, 200);
  const n = await res.json();
  assert.equal(n.generatedBy, 'offline');
  assert.equal(n.source.license, 'CC BY-SA 4.0');
  assert.match(n.markdown, /## Calvin cycle/);
});

test('MIT OCW page import, robots.txt respected, other sites refused', async () => {
  const ok = await post('/api/notes', { source: 'url', url: 'https://ocw.mit.edu/courses/14-01/lecture-4/' });
  assert.equal(ok.status, 200);
  const n = await ok.json();
  assert.equal(n.source.name, 'MIT OpenCourseWare');
  assert.ok(n.definitions.some(d => d.term === 'Demand'));

  const blocked = await post('/api/notes', { source: 'url', url: 'https://ocw.mit.edu/search/?q=x' });
  assert.equal(blocked.status, 403);
  const other = await post('/api/notes', { source: 'url', url: 'https://example.com/page' });
  assert.equal(other.status, 400);
});

test('plan endpoint validates input', async () => {
  const ok = await post('/api/plan', { topics: ['A'], startDate: '2026-12-01', examDate: '2026-12-08' });
  assert.equal(ok.status, 200);
  const bad = await post('/api/plan', { topics: ['A'], startDate: 'nope', examDate: '2026-12-08' });
  assert.equal(bad.status, 400);
});
