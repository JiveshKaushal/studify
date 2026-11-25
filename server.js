import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSources, search, getDocument, externalSearchLinks } from './src/sources.js';
import { buildNotes, notesToMarkdown } from './src/summarize.js';
import { buildPlan } from './src/planner.js';
import { aiAvailable, buildAiNotes } from './src/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(here, 'public')));
  // KaTeX (formula rendering) is served from the installed package, no CDN needed.
  app.use('/vendor/katex', express.static(path.join(here, 'node_modules', 'katex', 'dist'), { maxAge: '7d' }));

  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
    const status = err.status || (err.name === 'TimeoutError' ? 504 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 504 ? 'The source site took too long to answer.' : err.message });
  });

  app.get('/api/status', (req, res) => res.json({ ai: aiAvailable() }));
  app.get('/api/sources', (req, res) => res.json(listSources()));

  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q || '');
    const source = String(req.query.source || 'wikipedia');
    res.json({ results: await search(source, q), elsewhere: externalSearchLinks(q) });
  }));

  app.post('/api/notes', wrap(async (req, res) => {
    const { source, id, url, detail = 'normal', mode = 'auto' } = req.body || {};
    const doc = await getDocument({ source, id, url });
    let notes;
    let aiError;
    if (mode !== 'offline' && aiAvailable()) {
      try { notes = await buildAiNotes(doc, { detail }); } catch (e) { aiError = e.message; }
    }
    if (!notes) notes = buildNotes(doc, { detail });
    if (aiError) notes.notice = [`AI notes failed (${aiError}); showing offline notes instead.`, notes.notice].filter(Boolean).join(' ');
    notes.markdown = notesToMarkdown(notes);
    res.json(notes);
  }));

  app.post('/api/plan', wrap(async (req, res) => res.json(buildPlan(req.body || {}))));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Studify running at http://localhost:${port} (AI notes: ${aiAvailable() ? 'on' : 'off'})`));
}
