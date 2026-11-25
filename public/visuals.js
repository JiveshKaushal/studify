// Formula rendering and the concept-map diagram for notes.

const MATHML_TAGS = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'semantics', 'mmultiscripts', 'mprescripts', 'none']);

// The server already cleans MathML; this is a second check before it goes into the page.
function safeMathML(markup) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, 'text/html');
  const math = doc.body.querySelector('math');
  if (!math) return null;
  for (const el of [math, ...math.querySelectorAll('*')]) {
    if (!MATHML_TAGS.has(el.localName)) { el.replaceWith(...el.childNodes); continue; }
    for (const a of [...el.attributes]) if (/^on|href|src|style/i.test(a.name)) el.removeAttribute(a.name);
  }
  return document.importNode(math, true);
}

// Render \( \) and \[ \] LaTeX with KaTeX, and ⟦mN⟧ placeholders with MathML.
export function typeset(root, mathml = {}) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (/⟦m\d+⟧/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of node.nodeValue.split(/(⟦m\d+⟧)/)) {
      const m = part.match(/^⟦m(\d+)⟧$/);
      const el = m && mathml[m[1]] ? safeMathML(mathml[m[1]]) : null;
      frag.append(el || (m ? '' : part));
    }
    node.replaceWith(frag);
  }
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    });
  }
}

// Wait for the deferred KaTeX scripts if they are still loading.
export function whenMathReady() {
  if (window.renderMathInElement) return Promise.resolve();
  return new Promise(resolve => {
    window.addEventListener('load', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = s => String(s).replace(/\\[()[\]]/g, '').replace(/⟦m\d+⟧/g, '').replace(/\s+/g, ' ').trim();

function wrap(text, max = 16, lines = 2) {
  const words = plain(text).split(' ');
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (cur && (cur + ' ' + w).length > max) {
      if (out.length === lines) { out[out.length - 1] = cur.replace(/.{0,2}$/, '') + '…'; return out; }
      out.push(w);
    } else out[out.length - 1] = cur ? cur + ' ' + w : w;
  }
  return out.map(l => (l.length > max + 2 ? l.slice(0, max) + '…' : l));
}

function node(x, y, text, kind) {
  const lines = wrap(text, kind === 'center' ? 18 : kind === 'branch' ? 16 : 14);
  const w = Math.max(...lines.map(l => l.length)) * (kind === 'leaf' ? 6.6 : 7.4) + 22;
  const h = lines.length * 16 + 14;
  const tspans = lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? -(lines.length - 1) * 8 + 5 : 16}">${esc(l)}</tspan>`).join('');
  return { box: { x, y, w, h }, svg: `<g class="cm-${kind}"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${kind === 'leaf' ? h / 2 : 10}"/><text x="${x}" y="${y}" text-anchor="middle">${tspans}</text></g>` };
}

// A radial map: the topic in the middle, sections around it, and terms from each section on the outside.
export function conceptMap(n) {
  const generic = /^(solution|strategy|example|examples|significance|check your understanding|summary|key ideas|introduction|overview)$/i;
  const seenHeads = new Set();
  const branches = [...(n.overview?.length ? [{ heading: 'Key ideas', points: n.overview }] : []), ...(n.sections || [])]
    .filter((b, i) => i === 0 && b.heading === 'Key ideas' || (!generic.test(plain(b.heading)) && !seenHeads.has(plain(b.heading).toLowerCase()) && seenHeads.add(plain(b.heading).toLowerCase())))
    .slice(0, 8);
  if (branches.length < 2) return '';
  // Stem so "Photosynthesis", "photosynthetic" and "fixation"/"Carbon fixation" count as the same idea.
  const stem = t => plain(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => w.slice(0, 7)).join(' ');
  const filler = new Set(['process', 'example', 'written', 'respect', 'direction', 'function', 'number', 'result', 'value', 'called', 'various', 'system', 'general']);
  const defTerms = (n.definitions || []).map(d => d.term);
  const terms = [...defTerms, ...(n.keyTerms || []).filter(t => t.includes(' ') || (t.length >= 8 && !filler.has(t.toLowerCase())))];
  const used = new Set([stem(n.title)]);
  const overlaps = (a, b) => a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
  const leavesFor = b => {
    const text = (b.heading + ' ' + b.points.join(' ')).toLowerCase();
    const head = stem(b.heading);
    const picks = [];
    for (const t of terms) {
      const st = stem(t);
      if (picks.length >= 2 || t.length <= 3 || filler.has(t.toLowerCase())) continue;
      if ([...used].some(u => overlaps(u, st)) || overlaps(head, st) || !text.includes(t.toLowerCase())) continue;
      used.add(st);
      picks.push(t);
    }
    return picks;
  };
  const W = 760, H = 520, cx = W / 2, cy = H / 2;
  const rx = 215, ry = 150, lrx = 335, lry = 225;
  const parts = [];
  const lines = [];
  branches.forEach((b, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / branches.length;
    const bx = cx + rx * Math.cos(a), by = cy + ry * Math.sin(a);
    lines.push(`<line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" class="cm-edge"/>`);
    const leaves = leavesFor(b);
    leaves.forEach((t, j) => {
      const la = a + (j - (leaves.length - 1) / 2) * (0.42 / Math.max(1, branches.length / 6));
      const lx = Math.min(W - 60, Math.max(60, cx + lrx * Math.cos(la))), ly = Math.min(H - 20, Math.max(20, cy + lry * Math.sin(la)));
      lines.push(`<line x1="${bx}" y1="${by}" x2="${lx}" y2="${ly}" class="cm-edge cm-edge-leaf"/>`);
      parts.push(node(lx, ly, t, 'leaf').svg);
    });
    parts.push(node(bx, by, b.heading, 'branch').svg);
  });
  parts.push(node(cx, cy, n.title, 'center').svg);
  return `<figure class="concept-map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Concept map of ${esc(plain(n.title))}">${lines.join('')}${parts.join('')}</svg>
    <figcaption>Concept map: the topic in the middle, its main parts around it, and key terms from each part.</figcaption></figure>`;
}
