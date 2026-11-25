// Optional: AI-written notes with Claude. Used only when ANTHROPIC_API_KEY is set.
import Anthropic from '@anthropic-ai/sdk';
import { expandTokens } from './math.js';
import { attachMedia } from './summarize.js';

const MODEL = process.env.STUDIFY_MODEL || 'claude-opus-5-5';
let client = null;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM = `You write simplified study notes for students. Use only facts stated in the source text you are given; do not add outside facts.
Write in plain, simple language a 15-year-old can follow. Short sentences. Explain jargon the first time it appears.
Reply with a single JSON object and nothing else, using exactly this shape:
{"tldr": string (one sentence),
 "overview": string[] (3-5 bullet points),
 "sections": [{"heading": string, "points": string[] (2-5 bullets)}] (up to 8),
 "definitions": [{"term": string, "definition": string}] (up to 12),
 "keyTerms": string[] (up to 12),
 "flashcards": [{"q": string, "a": string}] (6-10),
 "formulas": [{"latex": string, "meaning": string, "symbols": [{"symbol": string, "meaning": string}]}] (the key formulas from the source, up to 8; [] if none),
 "analogy": string (one everyday analogy that explains the core idea)}
Formulas in the source appear as LaTeX between \\( \\) or \\[ \\]. Copy formulas exactly; never invent one.
In any text field you may write inline math as \\(...\\). In "latex" and "symbol" write bare LaTeX without delimiters.`;

export async function buildAiNotes(doc, { detail = 'normal' } = {}) {
  const math = doc.math || [];
  const body = doc.sections.map(s => `## ${s.heading}\n${expandTokens(s.text, math).replace(/⟦m\d+⟧/g, '[formula]')}`).join('\n\n');
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Detail level: ${detail}.\nTopic: ${doc.title}\nSource: ${doc.sourceName} (${doc.url})\n\n<source_text>\n${body}\n</source_text>`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const n = JSON.parse(json);
  const words = body.split(/\s+/).length;
  return attachMedia({
    title: doc.title,
    tldr: String(n.tldr || ''),
    overview: arr(n.overview).map(String),
    sections: arr(n.sections).map(s => ({ heading: String(s.heading || ''), points: arr(s.points).map(String) })),
    definitions: arr(n.definitions).map(d => ({ term: String(d.term || ''), definition: String(d.definition || '') })),
    keyTerms: arr(n.keyTerms).map(String),
    flashcards: arr(n.flashcards).map(f => ({ q: String(f.q || ''), a: String(f.a || '') })),
    formulas: arr(n.formulas).filter(f => f && f.latex).map(f => ({
      latex: String(f.latex).replace(/^\\[[(]|\\[\])]$/g, '').trim(),
      meaning: String(f.meaning || ''),
      symbols: arr(f.symbols).map(x => ({ symbol: String(x.symbol || ''), meaning: String(x.meaning || '') })),
    })),
    analogy: n.analogy ? String(n.analogy) : undefined,
    stats: { sourceWords: words, readingMinutes: Math.max(1, Math.round(words / 220)) },
    source: { name: doc.sourceName, url: doc.url, license: doc.license, authors: doc.authors },
    related: doc.related || [],
    notice: doc.notice,
    generatedBy: 'ai',
  }, doc, detail);
}

const arr = v => (Array.isArray(v) ? v : []);
