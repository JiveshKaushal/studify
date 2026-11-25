import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSources, search, getDocument, externalSearchLinks, fetchPdf, documentFromOcr } from './src/sources.js';
import { buildNotes, notesToMarkdown } from './src/summarize.js';
import { buildPlan } from './src/planner.js';
import { aiAvailable, buildAiNotes } from './src/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(express.static(path.join(here, 'public')));
  // KaTeX (formula rendering) is served from the installed package, no CDN needed.
  const jsModules = { maxAge: '7d', setHeaders: (res, file) => { if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); } };
  app.use('/vendor/pdfjs', express.static(path.join(here, 'node_modules', 'pdfjs-dist', 'build'), jsModules));
  // OCR engine (tesseract.js), its WebAssembly core and English language data, all served locally.
  const wasm = { maxAge: '7d', setHeaders: (res, file) => { if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm'); } };
  app.use('/vendor/tesseract', express.static(path.join(here, 'node_modules', 'tesseract.js', 'dist'), wasm));
  app.use('/vendor/tesseract-core', express.static(path.join(here, 'node_modules', 'tesseract.js-core'), wasm));
  app.use('/vendor/tessdata', express.static(path.join(here, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'), { maxAge: '30d' }));
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

  const notesFor = async (doc, { detail, mode }) => {
    let notes;
    let aiError;
    if (mode !== 'offline' && aiAvailable()) {
      try { notes = await buildAiNotes(doc, { detail }); } catch (e) { aiError = e.message; }
    }
    if (!notes) notes = buildNotes(doc, { detail });
    if (aiError) notes.notice = [`AI notes failed (${aiError}); showing offline notes instead.`, notes.notice].filter(Boolean).join(' ');
    notes.markdown = notesToMarkdown(notes);
    return notes;
  };

  app.post('/api/notes', wrap(async (req, res) => {
    const { source, id, url, detail = 'normal', mode = 'auto' } = req.body || {};
    res.json(await notesFor(await getDocument({ source, id, url }), { detail, mode }));
  }));

  // The browser runs OCR on scanned PDFs and sends the recognised lines here.
  app.post('/api/notes/ocr', wrap(async (req, res) => {
    const { detail = 'normal', mode = 'auto', ...rest } = req.body || {};
    res.json(await notesFor(documentFromOcr(rest), { detail, mode }));
  }));

  // Lets the browser draw page previews of an allowed PDF (the source sites don't allow cross-site reads).
  app.get('/api/pdf', wrap(async (req, res) => {
    const buffer = await fetchPdf(String(req.query.url || ''));
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(buffer);
  }));

  app.post('/api/plan', wrap(async (req, res) => res.json(buildPlan(req.body || {}))));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Studify running at http://localhost:${port} (AI notes: ${aiAvailable() ? 'on' : 'off'})`));
}
