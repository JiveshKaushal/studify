// Pulls formulas out of HTML so text processing can't break them.
// Each formula becomes a token like ⟦m3⟧ in the text; the token map keeps the LaTeX or safe MathML.

const MATHML_TAGS = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'semantics', 'mmultiscripts', 'mprescripts', 'none']);
const MATHML_ATTRS = new Set(['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'linethickness', 'columnalign', 'rowalign', 'displaystyle', 'scriptlevel', 'notation', 'lspace', 'rspace', 'width', 'height', 'depth', 'largeop', 'movablelimits', 'symmetric', 'form']);

export const TOKEN_RE = /⟦m(\d+)⟧/g;

const escText = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = s => escText(s).replace(/"/g, '&quot;');

// Rebuilds MathML from an allowlist of tags and attributes, so no scripts, links or styles get through.
export function sanitizeMathML($, el) {
  const walk = node => {
    if (node.type === 'text') return escText(node.data);
    if (node.type !== 'tag') return '';
    const tag = node.name.toLowerCase();
    if (tag === 'annotation' || tag === 'annotation-xml') return '';
    const inner = (node.children || []).map(walk).join('');
    if (!MATHML_TAGS.has(tag)) return inner;
    const attrs = Object.entries(node.attribs || {})
      .filter(([k, v]) => MATHML_ATTRS.has(k.toLowerCase()) && !/[<>]|javascript:/i.test(v))
      .map(([k, v]) => ` ${k.toLowerCase()}="${escAttr(v)}"`).join('');
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };
  const out = walk(el);
  return out.startsWith('<math') ? out : `<math>${out}</math>`;
}

function texFromMathElement($, el) {
  const $el = $(el);
  const dataMw = $el.attr('data-mw');
  if (dataMw) {
    try { const src = JSON.parse(dataMw)?.body?.extsrc; if (src) return src.trim(); } catch { /* ignore */ }
  }
  const ann = $el.find('annotation[encoding="application/x-tex"], annotation[encoding="TeX"]').first().text().trim();
  if (ann) return stripDisplaystyle(ann);
  const alt = ($el.attr('alttext') || '').trim();
  if (alt) return stripDisplaystyle(alt);
  return null;
}

export function stripDisplaystyle(tex) {
  const m = tex.match(/^\{\\displaystyle\s*([\s\S]*)\}$/);
  return (m ? m[1] : tex).trim();
}

export class MathStore {
  constructor() { this.items = []; }
  add(entry) { this.items.push(entry); return ` ⟦m${this.items.length - 1}⟧ `; }
  get(id) { return this.items[id]; }
}

// Replace <math>, MathJax scripts and Wikipedia math with tokens (in place).
export function tokenizeHtmlMath($, root, store) {
  root.find('script[type^="math/tex"]').each((_, el) => {
    const display = /mode=display/.test($(el).attr('type'));
    $(el).replaceWith(store.add({ tex: $(el).text().trim(), display }));
  });
  root.find('mjx-container, .MathJax, .MathJax_Display, .MathJax_Preview, .mwe-math-fallback-image-inline, .mwe-math-fallback-image-display').each((_, el) => {
    const inner = $(el).find('math').first();
    if (inner.length) $(el).replaceWith(inner);
    else $(el).remove();
  });
  root.find('math').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') || '';
    const display = $el.attr('display') === 'block' || /block|display/.test(cls) || $el.parent().is('dd') && $el.parent().text().trim() === $el.text().trim();
    const tex = texFromMathElement($, el);
    $el.replaceWith(store.add(tex ? { tex, display } : { mathml: sanitizeMathML($, el), display }));
  });
}

// LaTeX written straight into the page text (\( \), \[ \], $$ $$), as on LibreTexts.
export function tokenizeTextMath(text, store) {
  return text
    .replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g, (_, a, b) => store.add({ tex: (a || b).trim(), display: true }))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, a) => store.add({ tex: a.trim(), display: false }));
}

// Turn tokens back into \( \) / \[ \] LaTeX; MathML-only formulas keep their token for the frontend.
export function expandTokens(text, math) {
  return String(text).replace(TOKEN_RE, (t, id) => {
    const m = math[id];
    if (!m) return '';
    if (m.tex) return m.display ? `\\[${m.tex}\\]` : `\\(${m.tex}\\)`;
    return t;
  }).replace(/(\\\])\s*[.,]/g, '$1').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// A formula is worth listing on its own if it's displayed or looks like an equation.
export function isNotableFormula(m) {
  if (!m) return false;
  if (m.display) return true;
  const src = m.tex || m.mathml.replace(/<[^>]+>/g, '');
  return /[=≤≥<>≈]|\\(le|ge|approx|leq|geq|sum|int|frac|lim)/.test(src) && src.length > 6;
}
