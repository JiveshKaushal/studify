import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromHtml } from '../src/extract.js';
import { buildNotes, notesToMarkdown } from '../src/summarize.js';
import { tokenizeTextMath, MathStore, expandTokens } from '../src/math.js';

const WIKI = `<html><head><title>Derivative</title></head><body>
<section><p>In mathematics, the derivative is a fundamental tool that quantifies the sensitivity to change of a function's output with respect to its input.</p>
<figure typeof="mw:File/Thumb"><a href="./File:Tangent.svg" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/t.png" width="300" height="200"></a><figcaption>The graph of a function, drawn in black, and a tangent line to that graph.</figcaption></figure>
<span typeof="mw:File/Frameless"><img src="//upload.wikimedia.org/icon.png" width="20" height="20"></span></section>
<section><h2>As a limit</h2>
<p>A function <math class="mwe-math-element mwe-math-element-inline" data-mw='{"name":"math","body":{"extsrc":"f"}}'><mi>f</mi></math> is differentiable at a point when the limit of the difference quotient exists, and its derivative is then
<math class="mwe-math-element mwe-math-element-block" display="block" data-mw='{"name":"math","body":{"extsrc":"L=\\\\lim_{h \\\\to 0}\\\\frac{f(a+h)-f(a)}{h}"}}'><mi>L</mi></math> The division happens before the limit is taken.</p>
<p>The derivative of a constant function is zero, which follows from the definition because the difference quotient is always zero for such a function.</p></section>
<section><h2>References</h2><p>Some reference text that is long enough to be counted as a paragraph of content here.</p>
<figure><img src="https://example.org/ref.png" width="400" height="300"><figcaption>Should be skipped.</figcaption></figure></section>
</body></html>`;

test('Wikipedia HTML: LaTeX formulas, figures with captions and credit, references skipped', () => {
  const doc = extractFromHtml(WIKI, 'https://en.wikipedia.org/wiki/Derivative', { title: 'Derivative' });
  assert.deepEqual(doc.sections.map(s => s.heading), ['Introduction', 'As a limit']);
  assert.equal(doc.figures.length, 1);
  assert.equal(doc.figures[0].src, 'https://upload.wikimedia.org/wikipedia/commons/thumb/t.png');
  assert.equal(doc.figures[0].credit, 'https://en.wikipedia.org/wiki/File:Tangent.svg');
  assert.match(doc.figures[0].caption, /tangent line/);
  const block = doc.math.find(m => m.display);
  assert.equal(block.tex, 'L=\\lim_{h \\to 0}\\frac{f(a+h)-f(a)}{h}');
  assert.equal(block.section, 'As a limit');

  const n = buildNotes({ ...doc, url: 'u', sourceName: 'Wikipedia', license: 'CC BY-SA 4.0' });
  assert.equal(n.formulas.length, 1);
  assert.equal(n.formulas[0].latex, block.tex);
  assert.match(n.formulas[0].context, /derivative is then:$/);
  assert.ok(n.sections[0].points.some(p => p.includes('\\(f\\)')), 'inline math kept as LaTeX in points');
  assert.equal(n.figures.length, 1);
  assert.ok(!JSON.stringify(n).includes('⟦'), 'no tokens left when every formula has LaTeX');
  const md = notesToMarkdown(n);
  assert.match(md, /\$\$L=\\lim/);
  assert.match(md, /!\[The graph of a function/);
});

test('MathML without LaTeX is kept but cleaned of anything unsafe', () => {
  const html = `<html><body><main><h2>Vectors</h2>
    <p>When a vector is multiplied by a scalar the result is a new vector that is parallel to the original vector, as the equation shows.</p>
    <div data-type="equation"><math display="block"><mi onclick="alert(1)" href="javascript:x">B</mi><mo>=</mo><mi>α</mi><mi>A</mi><script>alert(2)</script><a href="https://evil">x</a><annotation-xml encoding="MathML-Content"><ci>junk</ci></annotation-xml></math></div>
    <figure><span data-alt="A dog with an arrow"><button><img src="/apps/image-cdn/dog.webp" width="500" height="300"></button></span><figcaption>Figure 2.2 A vector drawn from tail to head.</figcaption></figure>
  </main></body></html>`;
  const doc = extractFromHtml(html, 'https://openstax.org/books/physics/pages/2-1');
  const m = doc.math.find(x => x.mathml);
  assert.ok(m.display);
  assert.equal(m.mathml, '<math display="block"><mi>B</mi><mo>=</mo><mi>α</mi><mi>A</mi>x</math>');
  assert.equal(doc.figures[0].src, 'https://openstax.org/apps/image-cdn/dog.webp');
  const n = buildNotes({ ...doc, url: 'u', sourceName: 'OpenStax', license: 'CC BY 4.0' });
  assert.equal(n.formulas.length, 1);
  assert.match(n.formulas[0].mathml, /^⟦m\d+⟧$/);
  assert.equal(Object.values(n.mathml)[0], m.mathml);
  assert.match(n.formulas[0].context, /parallel to the original vector/);
});

test('LaTeX typed into page text (LibreTexts style) survives sentence processing', () => {
  const store = new MathStore();
  const t = tokenizeTextMath('The area is \\(A = \\pi r^2\\). For a sphere \\[V = \\tfrac{4}{3}\\pi r^3.\\]', store);
  assert.equal(store.items.length, 2);
  assert.ok(!t.includes('\\('));
  assert.equal(expandTokens(t, store.items), 'The area is \\(A = \\pi r^2\\). For a sphere \\[V = \\tfrac{4}{3}\\pi r^3.\\]');
});
