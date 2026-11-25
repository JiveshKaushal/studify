// Offline, dependency-free note builder: extractive summary + simplification.

const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your may might must one two also however thus often many much used use using called known such like within without well since per via first second new based include includes including').split(' '));

const PLAIN = [
  [/\bin order to\b/gi, 'to'], [/\butili[sz]e[sd]?\b/gi, 'use'], [/\butili[sz]ation\b/gi, 'use'],
  [/\bapproximately\b/gi, 'about'], [/\bsubsequently\b/gi, 'later'], [/\bnumerous\b/gi, 'many'],
  [/\bcommence[sd]?\b/gi, 'start'], [/\bterminate[sd]?\b/gi, 'end'], [/\bdemonstrate[sd]?\b/gi, 'show'],
  [/\bfacilitate[sd]?\b/gi, 'help'], [/\bprior to\b/gi, 'before'], [/\bin addition\b/gi, 'also'],
  [/\bnevertheless\b/gi, 'still'], [/\bconsequently\b/gi, 'so'], [/\btherefore\b/gi, 'so'],
  [/\bsufficient\b/gi, 'enough'], [/\bobtain(s|ed)?\b/gi, 'get$1'], [/\bin the event that\b/gi, 'if'],
  [/\bdue to the fact that\b/gi, 'because'], [/\bwith regard to\b/gi, 'about'], [/\ba number of\b/gi, 'several'],
];

const BAD_TERM_START = new Set('although after before during following here there those these this that such its their another every each most some many all one term result results reason way part example kind type process number amount level main key other same how why where whether because'.split(' '));

const ABBREV = /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|St|Fig|No|approx|ca|cf|al|Jr|Sr|Inc|Ltd|U\.S|U\.K)\.$/i;

export function splitSentences(text) {
  // Split only where end punctuation is followed by whitespace and a capital letter or digit.
  const parts = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?]["')\]]*)\s+(?=["'(\[]?[A-Z0-9])/);
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    // Re-join splits caused by abbreviations ("Dr. Smith") or initials ("J. Smith").
    if (out.length && (ABBREV.test(out[out.length - 1]) || /(^|\s)[A-Z]\.$/.test(out[out.length - 1]))) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out;
}

const words = s => (s.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter(w => !STOP.has(w) && w.length > 2);

export function simplifySentence(s) {
  let t = s
    .replace(/\[[^\]]*\]/g, '')                 // citation marks like [1]
    .replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, '') // parentheticals
    .replace(/\{\\displaystyle[^}]*\}/g, '')
    .replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  for (const [re, rep] of PLAIN) t = t.replace(re, m => matchCase(m, rep.replace('$1', '')));
  if (t.length > 220 && t.includes(';')) t = t.split(';')[0].trim() + '.';
  if (!/[.!?]$/.test(t)) t += '.';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function matchCase(orig, rep) { return /^[A-Z]/.test(orig) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep; }

function frequencies(text) {
  const f = new Map();
  for (const w of words(text)) f.set(w, (f.get(w) || 0) + 1);
  return f;
}

// Pick the most informative sentences, returned in original order.
const BOILERPLATE = /^(by the end of this (section|chapter|module|lecture)|in this (section|chapter|lecture|module), (you|we) will|learning objectives|you will be able to|this (page|section) (contains|provides|includes)|(describe|explain|identify|list|compare|define|discuss|summari[sz]e|understand|analy[sz]e|recogni[sz]e|outline|state) (the|how|what|why|a|an)\b)/i;

export function topSentences(text, k, globalFreq) {
  const sents = splitSentences(text).filter(s => s.length > 30 && s.length < 450 && !BOILERPLATE.test(s));
  if (sents.length <= k) return sents;
  const freq = globalFreq || frequencies(text);
  const max = Math.max(...freq.values(), 1);
  const scored = sents.map((s, i) => {
    const ws = words(s);
    const sum = ws.reduce((a, w) => a + (freq.get(w) || 0) / max, 0);
    const position = i === 0 ? 1.5 : i < 3 ? 1.15 : 1;
    const lengthPenalty = s.length > 280 ? 0.8 : 1;
    const definitional = /\b(is|are|refers to|means|describes|defined as)\b/.test(s) ? 1.2 : 1;
    return { i, s, score: (sum / Math.sqrt(ws.length + 1)) * position * lengthPenalty * definitional };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, k).sort((a, b) => a.i - b.i).map(x => x.s);
}

export function findDefinitions(text, title) {
  const defs = [];
  const seen = new Set();
  for (const s of splitSentences(text)) {
    const clean = simplifySentence(s);
    const m = clean.match(/^(?:(?:An?|The)\s+)?([A-Za-z][\w\s'-]{1,48}?)\s+(is|are|refers to|means|is defined as|describes)\s+(.{15,240})$/);
    if (!m) continue;
    let term = m[1].trim();
    const ws = term.split(/\s+/);
    if (ws.length > 4) continue;
    const first = ws[0].toLowerCase();
    if (/^(it|this|they)$/i.test(term)) continue;
    else if (ws.length === 1 && term.length < 5) continue;
    else if (STOP.has(first) || BAD_TERM_START.has(first) || /(ed|ing|ly)$/.test(first) && ws.length > 1) continue;
    else if (ws.slice(1).some(w => /ly$/.test(w) || (STOP.has(w.toLowerCase()) && !['of', 'and'].includes(w.toLowerCase())))) continue;
    else if (ws.length === 1 && /(ed|ing|ly)$/.test(first)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    defs.push({ term, definition: m[3].replace(/\.$/, '') });
    if (defs.length >= 12) break;
  }
  return defs;
}

export function keyTerms(text, n = 12) {
  const counts = new Map();
  // Capitalised multi-word phrases and frequent bigrams make good study terms.
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
    const phrase = m[1].split(' ').filter((w, i) => i > 0 || !STOP.has(w.toLowerCase())).join(' ');
    if (phrase.includes(' ')) counts.set(phrase, (counts.get(phrase) || 0) + 2);
  }
  // Bigrams only within a clause, so "plants, algae" doesn't become a term.
  for (const clause of text.split(/[.,;:!?()\[\]"]/)) {
    const ws = words(clause);
    for (let i = 0; i < ws.length - 1; i++) {
      const bg = ws[i] + ' ' + ws[i + 1];
      counts.set(bg, (counts.get(bg) || 0) + 1);
    }
  }
  for (const [w, c] of frequencies(text)) if (w.length > 6) counts.set(w, (counts.get(w) || 0) + c * 0.6);
  return [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
    .map(([t]) => t).filter((t, i, arr) => !arr.slice(0, i).some(p => p.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(p.toLowerCase())))
    .slice(0, n);
}

// doc: { title, url, sourceName, license, sections: [{heading, text}] }
export function buildNotes(doc, { detail = 'normal' } = {}) {
  const perSection = detail === 'brief' ? 2 : detail === 'detailed' ? 5 : 3;
  const maxSections = detail === 'brief' ? 5 : detail === 'detailed' ? 14 : 8;
  const all = doc.sections.map(s => s.text).join(' ');
  const freq = frequencies(all);
  const intro = doc.sections[0]?.text || all;

  const sections = doc.sections
    .filter(s => s.text.length > 120 && !/^(learning objectives|objectives|key terms|glossary|references|footnotes)$/i.test(s.heading))
    .slice(0, maxSections + 1)
    .map(s => ({ heading: s.heading, points: topSentences(s.text, perSection, freq).map(simplifySentence) }))
    .filter(s => s.points.length);
  const [overviewSection, ...rest] = sections;

  const definitions = findDefinitions(all, doc.title);
  const flashcards = definitions.slice(0, 8).map(d => ({ q: `What is ${d.term.includes(' ') || /^[A-Z]{2,}/.test(d.term) ? d.term : d.term.toLowerCase()}?`, a: d.definition + '.' }));
  for (const s of rest) {
    if (flashcards.length >= 10) break;
    if (s.points[0]) flashcards.push({ q: `Explain "${s.heading}" in one or two sentences.`, a: s.points[0] });
  }

  const wordCount = all.split(/\s+/).length;
  return {
    title: doc.title,
    tldr: simplifySentence(firstGoodSentence(intro) || topSentences(intro, 1, freq)[0] || doc.title),
    overview: overviewSection ? overviewSection.points : [],
    sections: rest.slice(0, maxSections),
    definitions,
    keyTerms: keyTerms(all),
    flashcards,
    stats: { sourceWords: wordCount, readingMinutes: Math.max(1, Math.round(wordCount / 220)) },
    source: { name: doc.sourceName, url: doc.url, license: doc.license, authors: doc.authors },
    related: doc.related || [],
    notice: doc.notice,
    generatedBy: 'offline',
  };
}

function firstGoodSentence(text) {
  const s = splitSentences(text).find(x => !BOILERPLATE.test(x));
  return s && s.length >= 40 && s.length <= 320 ? s : null;
}

export function notesToMarkdown(n) {
  const lines = [`# ${n.title}`, '', `> ${n.tldr}`, ''];
  if (n.overview?.length) lines.push('## Key ideas', ...n.overview.map(p => `- ${p}`), '');
  for (const s of n.sections || []) lines.push(`## ${s.heading}`, ...s.points.map(p => `- ${p}`), '');
  if (n.definitions?.length) lines.push('## Key definitions', ...n.definitions.map(d => `- **${d.term}**: ${d.definition}`), '');
  if (n.keyTerms?.length) lines.push('## Key terms', n.keyTerms.join(' · '), '');
  if (n.flashcards?.length) lines.push('## Flashcards', ...n.flashcards.map(f => `- **Q:** ${f.q}\n  **A:** ${f.a}`), '');
  if (n.source) lines.push('---', `Source: [${n.source.name}](${n.source.url}) (${n.source.license}). Notes generated by Studify.`);
  return lines.join('\n');
}
