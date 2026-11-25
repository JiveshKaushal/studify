import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedByRobots } from '../src/http.js';
import { extractFromHtml, sectionsFromWikiText } from '../src/extract.js';
import { buildNotes, splitSentences, simplifySentence, notesToMarkdown } from '../src/summarize.js';
import { buildPlan } from '../src/planner.js';
import { siteForUrl, parseArxiv } from '../src/sources.js';
import { WIKI_EXTRACT, OCW_HTML } from './fixtures.js';

test('robots.txt: wildcard group, longest match, allow overrides', () => {
  const txt = 'User-agent: *\nDisallow: /private/\nAllow: /private/public\nDisallow: /*.pdf$\n\nUser-agent: BadBot\nDisallow: /';
  assert.equal(isAllowedByRobots(txt, '/courses/x'), true);
  assert.equal(isAllowedByRobots(txt, '/private/x'), false);
  assert.equal(isAllowedByRobots(txt, '/private/public/page'), true);
  assert.equal(isAllowedByRobots(txt, '/file.pdf'), false);
  assert.equal(isAllowedByRobots('User-agent: studifybot\nDisallow: /', '/a'), false);
  assert.equal(isAllowedByRobots('User-agent: *\nDisallow:', '/a'), true);
});

test('wiki text is split into sections and reference sections dropped', () => {
  const s = sectionsFromWikiText(WIKI_EXTRACT);
  assert.deepEqual(s.map(x => x.heading), ['Introduction', 'Overview', 'Light-dependent reactions', 'Calvin cycle']);
});

test('HTML extraction keeps main content, drops nav/footer', () => {
  const d = extractFromHtml(OCW_HTML);
  assert.equal(d.title, 'Lecture 4: Supply and Demand');
  assert.deepEqual(d.sections.map(s => s.heading), ['Lecture 4: Supply and Demand', 'Demand', 'Supply']);
  const all = JSON.stringify(d);
  assert.ok(!all.includes('Menu links') && !all.includes('Footer text'));
  assert.ok(all.includes('demand curve slopes downward'));
});

test('sentence splitting respects abbreviations and decimals', () => {
  const s = splitSentences('Dr. Smith measured 2.5 percent. It rose, e.g. in spring. Done!');
  assert.deepEqual(s, ['Dr. Smith measured 2.5 percent.', 'It rose, e.g. in spring.', 'Done!']);
});

test('simplify removes citations/parentheticals and plain-English swaps', () => {
  assert.equal(simplifySentence('ATP synthase is used in order to make ATP (adenosine triphosphate)[3]'), 'ATP synthase is used to make ATP.');
  assert.equal(simplifySentence('Approximately half utilize it'), 'About half use it.');
});

test('notes from a wiki article have overview, sections, definitions and flashcards', () => {
  const doc = { title: 'Photosynthesis', url: 'https://en.wikipedia.org/wiki/Photosynthesis', sourceName: 'Wikipedia', license: 'CC BY-SA 4.0', sections: sectionsFromWikiText(WIKI_EXTRACT) };
  const n = buildNotes(doc);
  assert.match(n.tldr, /^Photosynthesis is a process/);
  assert.ok(n.overview.length >= 2);
  assert.deepEqual(n.sections.map(s => s.heading), ['Overview', 'Light-dependent reactions', 'Calvin cycle']);
  const terms = n.definitions.map(d => d.term.toLowerCase());
  assert.ok(terms.includes('chlorophyll'), terms.join());
  assert.ok(terms.includes('calvin cycle'), terms.join());
  assert.ok(n.flashcards.length >= 3);
  assert.ok(!JSON.stringify(n).includes('[3]'));
  const md = notesToMarkdown(n);
  assert.match(md, /^# Photosynthesis/);
  assert.match(md, /CC BY-SA 4.0/);
});

test('planner spreads topics, adds spaced reviews and a final revision day', () => {
  const p = buildPlan({ topics: ['A', 'B', 'C', ' '], startDate: '2026-12-01', examDate: '2026-12-15', minutesPerDay: 60 });
  assert.equal(p.days.length, 14);
  assert.equal(p.days[0].date, '2026-12-01');
  const learn = p.days.flatMap(d => d.tasks.filter(t => t.type === 'learn').map(t => t.topic));
  assert.deepEqual(learn, ['A', 'B', 'C']);
  assert.deepEqual(p.days[1].tasks.find(t => t.type === 'review'), { type: 'review', topic: 'A', minutes: 15 });
  const lastTopics = p.days.at(-1).tasks.map(t => t.topic).sort();
  assert.deepEqual(lastTopics, ['A', 'B', 'C']);
  assert.throws(() => buildPlan({ topics: ['A'], startDate: '2026-12-10', examDate: '2026-12-01' }), /after the start/);
  assert.throws(() => buildPlan({ topics: [], startDate: '2026-12-01', examDate: '2026-12-10' }), /at least one/);
});

test('only open-licensed sites can be imported', () => {
  assert.equal(siteForUrl('https://ocw.mit.edu/courses/18-06/')?.name, 'MIT OpenCourseWare');
  assert.equal(siteForUrl('https://chem.libretexts.org/Bookshelves/x')?.name, 'LibreTexts');
  assert.equal(siteForUrl('https://evilocw.mit.edu.example.com/'), null);
  assert.equal(siteForUrl('https://www.coursera.org/learn/x'), null);
  assert.equal(siteForUrl('file:///etc/passwd'), null);
});

test('arXiv Atom feed parsing', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is
   All You Need</title><summary> The dominant sequence transduction models are based on recurrent networks. </summary><author><name>Ashish Vaswani</name></author></entry></feed>`;
  const [e] = parseArxiv(xml);
  assert.equal(e.title, 'Attention Is All You Need');
  assert.equal(e.authors[0], 'Ashish Vaswani');
});

test('div-only course pages fall back to prose blocks and list sub-pages', () => {
  const html = `<html><head><title>Principles of Microeconomics | Economics | MIT OpenCourseWare</title></head><body><main>
    <div class="nav">Browse Course Material Syllabus Calendar Lecture Videos Problem Sets Exams Download Course Info Instructor</div>
    <div class="description">This introductory undergraduate course covers the fundamentals of microeconomics. Topics include supply and demand, market equilibrium, and consumer theory.</div>
    <a href="/courses/14-01-x/pages/syllabus/">Syllabus</a><a href="/courses/14-01-x/pages/exams/">Exams</a><a href="/courses/other/">Other</a><a href="/courses/14-01-x/pages/a/">Next</a>
  </main></body></html>`;
  const d = extractFromHtml(html, 'https://ocw.mit.edu/courses/14-01-x/');
  assert.equal(d.title, 'Principles of Microeconomics');
  assert.equal(d.sections.length, 1);
  assert.match(d.sections[0].text, /^This introductory undergraduate course/);
  assert.ok(!d.sections[0].text.includes('Browse Course Material'));
  assert.deepEqual(d.related.map(r => r.title), ['Syllabus', 'Exams']);
});

test('learning-objective boilerplate is skipped for the one-line summary', () => {
  const doc = { title: 'X', sections: [{ heading: 'Intro', text: 'By the end of this section, you will be able to do the following. Describe the main structures involved in photosynthesis. Photosynthesis is the process plants use to turn light into chemical energy stored in sugar.' }] };
  assert.match(buildNotes(doc).tldr, /^Photosynthesis is the process/);
});
