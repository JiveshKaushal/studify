import { typeset, whenMathReady, conceptMap } from './visuals.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('studify:' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('studify:' + key, JSON.stringify(value)); } catch { toast('Could not save in this browser.'); } },
};

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2500); }

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
  if (name === 'library') renderLibrary();
  store.set('tab', name);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Learn ----------
let currentNotes = null;

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  const source = $('#source').value;
  $('#notes').innerHTML = '';
  $('#results').innerHTML = `<div class="card"><span class="spinner"></span>Searching…</div>`;
  try {
    const { results, elsewhere } = await api(`/api/search?source=${source}&q=${encodeURIComponent(q)}`);
    const items = results.map((r, i) => `
      <div class="result">
        <div><strong>${esc(r.title)}</strong><p class="muted">${esc(r.snippet)}</p></div>
        <button class="primary" data-i="${i}">Make notes</button>
      </div>`).join('') || `<p class="muted">No results. Try different words or another source.</p>`;
    $('#results').innerHTML = `<div class="card"><h2>Results</h2>${items}
      <p class="small muted links">Also look on: ${elsewhere.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join('')}<br>Found a good page there? Paste its link in “Import a page” above.</p></div>`;
    $('#results').querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
      const r = results[b.dataset.i];
      makeNotes({ source: r.source, id: r.id }, b);
    }));
  } catch (err) {
    $('#results').innerHTML = `<div class="card notice">${esc(err.message)}</div>`;
  }
});

$('#urlForm').addEventListener('submit', e => {
  e.preventDefault();
  makeNotes({ source: 'url', url: $('#url').value.trim() }, e.submitter);
});

async function makeNotes(target, button) {
  const old = button?.textContent;
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner"></span>Working'; }
  $('#notes').innerHTML = `<div class="card"><span class="spinner"></span>Reading the source and writing notes…</div>`;
  try {
    const notes = await api('/api/notes', { ...target, detail: $('#detail').value, mode: $('#useAi').checked ? 'auto' : 'offline' });
    currentNotes = { ...notes, id: crypto.randomUUID(), savedAt: null };
    $('#notes').innerHTML = renderNotes(currentNotes, false);
    bindNoteActions($('#notes'), currentNotes);
    await whenMathReady();
    typeset($('#notes'), currentNotes.mathml);
    $('#notes').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('#notes').innerHTML = `<div class="card notice">${esc(err.message)}</div>`;
  } finally {
    if (button) { button.disabled = false; button.textContent = old; }
  }
}

function figureHtml(f) {
  return `<figure class="pic"><a href="${esc(f.src)}" target="_blank" rel="noopener"><img src="${esc(f.src)}" alt="${esc(f.caption || 'Diagram')}" loading="lazy" referrerpolicy="no-referrer"></a>
    <figcaption>${esc(f.caption)} <a class="credit" href="${esc(f.credit)}" target="_blank" rel="noopener">source &amp; license</a></figcaption></figure>`;
}

function formulasHtml(formulas) {
  return `<div class="formulas">${formulas.map(f => `<div class="formula">
    <div class="eq">${f.latex ? esc('\\[' + f.latex + '\\]') : esc(f.mathml || '')}</div>
    ${f.meaning ? `<p>${esc(f.meaning)}</p>` : ''}
    ${f.symbols?.length ? `<ul class="symbols">${f.symbols.map(x => `<li>${esc('\\(' + x.symbol + '\\)')} — ${esc(x.meaning)}</li>`).join('')}</ul>` : ''}
    ${!f.meaning && f.context ? `<p class="small muted">${esc(f.context)}</p>` : ''}
    ${f.section ? `<span class="small muted">from “${esc(f.section)}”</span>` : ''}
  </div>`).join('')}</div>`;
}

function renderNotes(n, saved) {
  const list = arr => `<ul>${arr.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
  const figures = n.figures || [];
  const shown = new Set();
  const figsFor = heading => figures.filter((f, i) => !shown.has(i) && f.section === heading && shown.add(i)).map(figureHtml).join('');
  const sectionsHtml = n.sections.map(s => `<h3>${esc(s.heading)}</h3>${list(s.points)}${figsFor(s.heading)}`).join('');
  const overviewFigs = figures.filter((f, i) => !shown.has(i) && shown.add(i)).slice(0, 2).map(figureHtml).join('');
  const rest = figures.filter((f, i) => !shown.has(i));
  return `<article class="card notes">
    <h2>${esc(n.title)}</h2>
    <p class="small muted">From <a href="${esc(n.source.url)}" target="_blank" rel="noopener">${esc(n.source.name)}</a> · ${esc(n.source.license)} · about ${n.stats.readingMinutes} min to read the original · ${n.generatedBy === 'ai' ? 'written by AI' : 'auto-summarised'}</p>
    ${n.notice ? `<p class="small notice">${esc(n.notice)}</p>` : ''}
    <div class="tldr"><strong>In one line:</strong> ${esc(n.tldr)}</div>
    ${n.analogy ? `<p><strong>Think of it like this:</strong> ${esc(n.analogy)}</p>` : ''}
    ${n.overview.length ? `<h3>Key ideas</h3>${list(n.overview)}` : ''}
    ${overviewFigs}
    ${conceptMap(n)}
    ${n.formulas?.length ? `<h3>Formulas</h3>${formulasHtml(n.formulas)}` : ''}
    ${sectionsHtml}
    ${rest.length ? `<h3>More diagrams</h3><div class="gallery">${rest.map(figureHtml).join('')}</div>` : ''}
    ${n.definitions.length ? `<h3>Key definitions</h3><dl>${n.definitions.map(d => `<dt>${esc(d.term)}</dt><dd>${esc(d.definition)}</dd>`).join('')}</dl>` : ''}
    ${n.keyTerms.length ? `<h3>Key terms</h3><div class="terms">${n.keyTerms.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    ${n.flashcards.length ? `<h3>Flashcards <span class="small muted">(tap to reveal)</span></h3><div class="flash">${n.flashcards.map(f => `<button class="flashcard"><div>${esc(f.q)}</div><div class="a">${esc(f.a)}</div></button>`).join('')}</div>` : ''}
    ${!saved && n.related?.length ? `<h3>More from this course or book</h3><div class="related">${n.related.map((r, i) => `<button type="button" class="link" data-rel="${i}">${esc(r.title)}</button>`).join('')}</div>` : ''}
    <div class="toolbar">
      ${saved ? '<button data-act="delete">Delete</button>' : '<button class="primary" data-act="save">Save to my notes</button>'}
      <button data-act="md">Download Markdown</button>
      <button data-act="copy">Copy</button>
      <button data-act="print">Print</button>
      <button data-act="plan">Add to planner</button>
    </div>
  </article>`;
}

function bindNoteActions(root, n) {
  root.querySelectorAll('[data-rel]').forEach(b => b.addEventListener('click', () => makeNotes({ source: 'url', url: n.related[b.dataset.rel].url }, b)));
  root.querySelectorAll('.flashcard').forEach(c => c.addEventListener('click', () => c.classList.toggle('open')));
  root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'save') {
      const lib = store.get('library', []);
      lib.unshift({ ...n, savedAt: new Date().toISOString() });
      store.set('library', lib); updateCount();
      b.disabled = true; b.textContent = 'Saved ✓'; toast('Saved to My notes');
    } else if (act === 'delete') {
      store.set('library', store.get('library', []).filter(x => x.id !== n.id)); updateCount(); renderLibrary(); toast('Deleted');
    } else if (act === 'md') {
      const blob = new Blob([n.markdown], { type: 'text/markdown' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: n.title.replace(/[^\w-]+/g, '_') + '.md' });
      a.click(); URL.revokeObjectURL(a.href);
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(n.markdown); toast('Copied as Markdown'); } catch { toast('Copy failed'); }
    } else if (act === 'print') {
      window.print();
    } else if (act === 'plan') {
      const t = $('#topics');
      const lines = t.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.includes(n.title)) t.value = [...lines, n.title].join('\n');
      store.set('planForm', readPlanForm());
      showTab('plan'); toast(`Added “${n.title}” to topics`);
    }
  }));
}

// ---------- Library ----------
function updateCount() { $('#libCount').textContent = store.get('library', []).length; }
function renderLibrary() {
  const f = $('#libFilter').value.toLowerCase();
  const lib = store.get('library', []).filter(n => !f || n.title.toLowerCase().includes(f) || n.keyTerms.join(' ').toLowerCase().includes(f));
  const root = $('#library');
  root.innerHTML = lib.length ? '' : `<div class="card muted">No saved notes yet. Make some in the Learn tab.</div>`;
  for (const n of lib) {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderNotes(n, true);
    bindNoteActions(wrap, n);
    root.append(wrap);
    whenMathReady().then(() => typeset(wrap, n.mathml));
  }
}
$('#libFilter').addEventListener('input', renderLibrary);

// ---------- Planner ----------
const today = () => new Date().toISOString().slice(0, 10);
function readPlanForm() {
  return {
    topics: $('#topics').value, startDate: $('#startDate').value, examDate: $('#examDate').value,
    minutesPerDay: Number($('#minutesPerDay').value), learnMinutes: Number($('#learnMinutes').value),
  };
}
function fillPlanForm(f) {
  $('#topics').value = f.topics || '';
  $('#startDate').value = f.startDate || today();
  $('#examDate').value = f.examDate || new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  $('#minutesPerDay').value = f.minutesPerDay || 60;
  $('#learnMinutes').value = f.learnMinutes || 45;
}

$('#planForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = readPlanForm();
  store.set('planForm', form);
  try {
    const plan = await api('/api/plan', { ...form, topics: form.topics.split('\n') });
    store.set('plan', plan); store.set('planDone', {});
    renderPlan();
  } catch (err) { $('#plan').innerHTML = `<div class="card notice">${esc(err.message)}</div>`; }
});
$('#clearPlan').addEventListener('click', () => { store.set('plan', null); store.set('planDone', {}); renderPlan(); });

function renderPlan() {
  const plan = store.get('plan', null);
  const done = store.get('planDone', {});
  if (!plan) { $('#plan').innerHTML = ''; return; }
  const all = plan.days.flatMap((d, di) => d.tasks.map((t, ti) => `${di}:${ti}`));
  const pct = all.length ? Math.round(all.filter(k => done[k]).length / all.length * 100) : 0;
  const t = today();
  $('#plan').innerHTML = `<div class="card">
    <h2>Your plan · ${esc(plan.startDate)} → exam ${esc(plan.examDate)}</h2>
    <div class="progress"><div style="width:${pct}%"></div></div><p class="small muted">${pct}% done</p>
    ${plan.warnings.map(w => `<p class="small notice">${esc(w)}</p>`).join('')}
    ${plan.days.map((d, di) => `<div class="day ${d.overloaded ? 'over' : ''}" ${d.date === t ? 'id="today"' : ''}>
      <header><span>${new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${d.date === t ? ' · today' : ''}</span><span class="small">${d.totalMinutes} min</span></header>
      ${d.tasks.length ? d.tasks.map((task, ti) => `<label class="task ${done[di + ':' + ti] ? 'done' : ''}">
        <input type="checkbox" data-k="${di}:${ti}" ${done[di + ':' + ti] ? 'checked' : ''}>
        <span class="tag ${task.type}">${task.type}</span><span class="label">${esc(task.topic)} · ${task.minutes} min</span>
        <button type="button" class="link" data-topic="${esc(task.topic)}">notes</button></label>`).join('') : '<p class="small muted">Rest day 🎉</p>'}
    </div>`).join('')}
  </div>`;
  $('#plan').querySelectorAll('input[data-k]').forEach(cb => cb.addEventListener('change', () => {
    const d = store.get('planDone', {}); d[cb.dataset.k] = cb.checked; store.set('planDone', d); renderPlan();
  }));
  $('#plan').querySelectorAll('button[data-topic]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const saved = store.get('library', []).find(n => n.title.toLowerCase() === b.dataset.topic.toLowerCase());
    if (saved) { showTab('library'); $('#libFilter').value = saved.title; renderLibrary(); return; }
    showTab('learn'); $('#q').value = b.dataset.topic; $('#searchForm').requestSubmit();
  }));
}

// ---------- Init ----------
(async function init() {
  fillPlanForm(store.get('planForm', {}));
  renderPlan(); updateCount();
  showTab(store.get('tab', 'learn'));
  try {
    const [{ ai }, sources] = await Promise.all([api('/api/status'), api('/api/sources')]);
    $('#aiToggleWrap').hidden = !ai;
    if (!ai) $('#useAi').checked = false;
    $('#importSites').textContent = 'Allowed sites: ' + sources.importable.map(s => `${s.name} (${s.license})`).join(', ') + '.';
  } catch { /* server status is optional */ }
})();
