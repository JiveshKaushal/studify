import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromPdf } from '../src/pdf.js';
import { createApp } from '../server.js';

// Builds a small valid PDF: each page is a list of [fontSize, y, text] lines.
export function makePdf(pages) {
  const objs = [];
  const add = body => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + pages.length * 2;
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map(([size, y, text]) => `BT /F1 ${size} Tf 72 ${y} Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const LECTURE = makePdf([
  [[10, 760, 'MIT OpenCourseWare'], [10, 740, 'For information about citing these materials or our Terms of Use, visit: http://ocw.mit.edu/terms.']],
  [[10, 760, 'Lecture 1 18.01 Fall 2006'], [16, 720, 'What is a derivative?'],
   [10, 690, 'The derivative is the slope of the line tangent to the graph of a function at a point.'],
   [10, 676, 'It measures how fast the output of the function changes when the input changes a little.'],
   [10, 650, 'Figure 1: A function with secant and tangent lines'], [10, 630, 'f(x) = x^2'], [10, 600, 'Slices of Pizza'], [10, 40, '2']],
  [[10, 760, 'Lecture 1 18.01 Fall 2006'], [16, 720, 'Physical interpretation'],
   [10, 690, 'If a car moves along a road, the derivative of its position with respect to time is its velocity.'],
   [10, 676, 'A secant line is a line drawn between two points on the graph of a function.'], [10, 40, '3']],
  [[10, 760, 'Lecture 1 18.01 Fall 2006'], [10, 690, 'The second derivative of position with respect to time is the acceleration of the car on the road.'], [10, 40, '4']],
]);

test('PDF lecture notes: headings, body text, cover page, running headers and captions', async () => {
  const d = await extractFromPdf(LECTURE);
  assert.equal(d.pages, 4);
  assert.deepEqual(d.sections.map(s => s.heading), ['What is a derivative?', 'Physical interpretation']);
  const all = d.sections.map(s => s.text).join(' ');
  assert.match(all, /^The derivative is the slope of the line tangent to the graph of a function at a point\. It measures/);
  for (const junk of ['OpenCourseWare', 'Lecture 1 18.01', 'Figure 1', 'Slices of Pizza', 'f(x) = x^2']) assert.ok(!all.includes(junk), junk);
  assert.deepEqual(d.visualPages, [{ page: 2, reason: 'figure', label: 'Figure 1: A function with secant and tangent lines' }]);
});

test('PDF import end to end: notes, preview pages and the /api/pdf endpoint', async () => {
  const realFetch = globalThis.fetch;
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, opts);
    if (u === 'https://ocw.mit.edu/robots.txt') return new Response('User-agent: *\nAllow: /');
    if (u.endsWith('/lec1.pdf')) return new Response(LECTURE, { headers: { 'content-type': 'application/pdf' } });
    if (u.endsWith('/resources/lec1/')) return new Response('<html><head><title>Lecture 1 | Calculus | MIT OpenCourseWare</title></head><body><main><a href="/courses/18-01/lec1.pdf">Download File</a></main></body></html>');
    if (u.endsWith('/notpdf.pdf')) return new Response('<html>nope</html>');
    return new Response('nf', { status: 404 });
  };
  try {
    const post = body => realFetch(base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const url of ['https://ocw.mit.edu/courses/18-01/lec1.pdf', 'https://ocw.mit.edu/courses/18-01/resources/lec1/']) {
      const res = await post({ source: 'url', url });
      assert.equal(res.status, 200, url);
      const n = await res.json();
      assert.equal(n.pdf.url, 'https://ocw.mit.edu/courses/18-01/lec1.pdf');
      assert.deepEqual(n.pdf.visualPages.map(v => v.page), [2]);
      assert.ok(n.sections.some(s => s.heading === 'Physical interpretation'));
      assert.match(n.markdown, /\[Page 2\]\(https:\/\/ocw\.mit\.edu\/courses\/18-01\/lec1\.pdf#page=2\)/);
      if (url.includes('resources')) assert.equal(n.title, 'Lecture 1');
    }
    const pdf = await realFetch(base + '/api/pdf?url=' + encodeURIComponent('https://ocw.mit.edu/courses/18-01/lec1.pdf'));
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await realFetch(base + '/api/pdf?url=' + encodeURIComponent('https://example.com/a.pdf'))).status, 400);
    assert.equal((await realFetch(base + '/api/pdf?url=' + encodeURIComponent('https://ocw.mit.edu/notpdf.pdf'))).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    server.close();
  }
});

test('scanned PDFs are detected and offered for OCR', async () => {
  const fs = await import('node:fs');
  const d = await extractFromPdf(fs.readFileSync(new URL('./fixtures/scanned.pdf', import.meta.url)));
  assert.equal(d.scanned, true);
  assert.equal(d.sections.length, 0);
  const normal = await extractFromPdf(LECTURE);
  assert.equal(normal.scanned, false);
});

test('OCR endpoint: bullets, running headers, wrapped bullets and title from the text', async () => {
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const line = (text, size, y) => ({ text, size, y: -y });
  try {
    const body = {
      url: 'https://ocw.mit.edu/courses/18-01/scan0001.pdf', title: 'scan0001', totalPages: 9,
      pages: [
        { number: 1, height: 2000, lines: [
          line('Lecture 1 18.01 Fall 2006', 30, 120),
          line('Lecture 1: Derivatives, Slope, Velocity,', 60, 300), line('and Rate of Change', 60, 370),
          line('/ What is a derivative?', 44, 500),
          line('e Important for any measurement in economics, science and', 30, 600),
          line('finance, because it describes how fast things change', 30, 640),
          line('® The derivative is the slope of the line tangent to the graph of a function.', 30, 700),
          line('The derivative measures how fast the output of a function changes when its input changes.', 30, 760),
          line('7', 30, 1900),
        ] },
      ],
    };
    const res = await fetch(base + '/api/notes/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    const n = await res.json();
    assert.equal(n.title, 'Lecture 1: Derivatives, Slope, Velocity, and Rate of Change');
    assert.equal(n.pdf.ocr, true);
    assert.match(n.notice, /OCR/);
    assert.match(n.notice, /Read 1 of 9 pages/);
    const text = JSON.stringify(n);
    assert.ok(text.includes('Important for any measurement in economics, science and finance, because it describes how fast things change.'), 'wrapped bullet joined, bullet mark removed');
    assert.ok(!/18\.01 Fall 2006|® |"e Important/.test(text));
    const bad = await fetch(base + '/api/notes/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, url: 'https://example.com/x.pdf' }) });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
