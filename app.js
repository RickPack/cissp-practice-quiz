import * as core from './lib/core.js';
import { renderBarChart } from './lib/charts.js';

const STORE_KEY = 'cissp-diagnostic:session';
const $ = (id) => document.getElementById(id);

const state = { bank: [], lookup: new Map(), taxonomy: null, bankVersion: '?', session: null, report: null };

const storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(session) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(session));
    } catch {
      // Storage unavailable (private mode, quota): the session continues in memory.
    }
  },
  clear() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // Nothing stored to clear.
    }
  },
};

// ---------- Helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function richText(node, text) {
  node.replaceChildren(
    ...core.emphasisRuns(text).map((r) => (r.strong ? el('strong', { text: r.text }) : document.createTextNode(r.text))),
  );
  return node;
}

const fmtPct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const fmtCI = (ci) => (ci ? `${fmtPct(ci[0])}–${fmtPct(ci[1])}` : '–');
const domainLabel = (d) => `D${d} ${state.taxonomy.domains[d].name}`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const STATUS = {
  strength: { icon: '✓', label: 'Strength' },
  adequate: { icon: '◐', label: 'Adequate' },
  weakness: { icon: '!', label: 'Weakness' },
  insufficient: { icon: '?', label: 'Insufficient data' },
};

function statusBadge(status) {
  const s = STATUS[status];
  return el('span', { class: `status status-${status}` }, el('span', { class: 'status-icon', 'aria-hidden': 'true', text: s.icon }), s.label);
}

function show(id) {
  for (const sec of ['start', 'quiz', 'report']) $(sec).hidden = sec !== id;
  $('loading').hidden = true;
  window.scrollTo(0, 0);
}

// ---------- Loading ----------

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

function usable(q, taxonomy) {
  return (
    q && typeof q.id === 'string' && typeof q.stem === 'string' && q.options &&
    core.LETTERS.every((L) => typeof q.options[L] === 'string') &&
    core.LETTERS.includes(q.answer) && String(q.domain) in taxonomy.domains &&
    core.DIFFICULTIES.includes(q.difficulty)
  );
}

async function loadBank() {
  const [manifest, taxonomy] = await Promise.all([fetchJSON('data/manifest.json'), fetchJSON('data/taxonomy.json')]);
  const batches = await Promise.all(manifest.batches.map((b) => fetchJSON(`data/${b.file}`)));
  const seen = new Set();
  const bank = [];
  for (const q of batches.flat()) {
    if (usable(q, taxonomy) && !seen.has(q.id)) {
      seen.add(q.id);
      bank.push(q);
    }
  }
  state.taxonomy = taxonomy;
  state.bank = bank;
  state.lookup = new Map(bank.map((q) => [q.id, q]));
  state.bankVersion = String(manifest.bank_version);
  $('bank-info').textContent = `Bank v${state.bankVersion}, ${bank.length} questions`;
}

function restore(saved) {
  if (!saved || saved.schema !== 1 || !Array.isArray(saved.items)) return null;
  const items = saved.items.filter((it) => state.lookup.has(it.id) && Array.isArray(it.perm) && it.perm.length === 4);
  if (!items.length) return null;
  const ids = new Set(items.map((it) => it.id));
  const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => ids.has(id)));
  return {
    ...saved,
    items,
    responses: keep(saved.responses),
    flagged: keep(saved.flagged),
    current: Math.min(Math.max(0, saved.current | 0), items.length - 1),
    dropped: saved.items.length - items.length,
  };
}

// ---------- Start screen ----------

function setupStart() {
  const max = core.maxSessionLength(state.bank.length);
  const range = $('length-range');
  const num = $('length-number');
  const enough = state.bank.length >= core.MIN_SESSION;
  for (const input of [range, num]) {
    input.min = String(core.MIN_SESSION);
    input.max = String(Math.max(core.MIN_SESSION, max));
    input.value = String(max);
    input.disabled = !enough;
  }
  $('length-help').textContent = enough
    ? `Choose ${core.MIN_SESSION} to ${max}. The bank currently holds ${state.bank.length} questions.`
    : `The bank has only ${state.bank.length} questions; at least ${core.MIN_SESSION} are needed.`;
  $('start-btn').disabled = !enough;

  const saved = restore(storage.load());
  $('resume-card').hidden = !(saved && !saved.submittedAt);
  $('last-report-card').hidden = !(saved && saved.submittedAt);
  if (saved && !saved.submittedAt) {
    const answered = core.answeredCount(saved);
    $('resume-text').textContent =
      `${answered} of ${saved.items.length} answered, started ${new Date(saved.startedAt).toLocaleString()}.` +
      (saved.dropped ? ` ${saved.dropped} question(s) no longer in the bank were removed.` : '');
  }
  if (saved && saved.submittedAt) {
    $('last-report-text').textContent = `Submitted ${new Date(saved.submittedAt).toLocaleString()}, ${core.answeredCount(saved)} of ${saved.items.length} answered.`;
  }
  show('start');
}

function clampLength(v) {
  const max = core.maxSessionLength(state.bank.length);
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return max;
  return Math.min(max, Math.max(core.MIN_SESSION, n));
}

function startSession({ length, seed, mode = 'standard', focusDomains = [] }) {
  state.session = core.createSession(state.bank, state.taxonomy, {
    length,
    seed: seed || core.newSeedString(),
    mode,
    focusDomains,
    bankVersion: state.bankVersion,
  });
  storage.save(state.session);
  showQuiz();
}

// ---------- Quiz ----------

function currentQuestion() {
  const it = state.session.items[state.session.current];
  return { it, q: state.lookup.get(it.id) };
}

function showQuiz() {
  show('quiz');
  renderQuestion();
}

function renderQuestion({ focusOptions = false } = {}) {
  const s = state.session;
  const { it, q } = currentQuestion();
  const view = core.viewQuestion(q, it.perm);
  const chosen = core.displayLetterFor(it.perm, s.responses[it.id]);

  $('q-index').textContent = String(s.current + 1);
  $('q-total').textContent = String(s.items.length);
  $('q-live').textContent = `Question ${s.current + 1} of ${s.items.length}`;
  richText($('stem'), q.stem);

  const fieldset = $('options');
  fieldset.querySelectorAll('.option').forEach((n) => n.remove());
  for (const [i, o] of view.options.entries()) {
    const input = el('input', {
      type: 'radio',
      name: 'answer',
      value: o.letter,
      id: `opt-${o.letter}`,
      'aria-keyshortcuts': `${i + 1} ${o.letter}`,
    });
    input.checked = o.letter === chosen;
    input.addEventListener('change', () => recordAnswer(o.letter));
    const text = el('span');
    richText(text, o.text);
    fieldset.append(el('label', { class: 'option', for: `opt-${o.letter}` }, input, el('span', { class: 'letter', text: `${o.letter}.` }), text));
  }

  const flagged = !!s.flagged[it.id];
  $('flag-btn').setAttribute('aria-pressed', String(flagged));
  $('flag-btn').textContent = flagged ? 'Flagged' : 'Flag for review';
  $('flag-badge').hidden = !flagged;
  $('prev-btn').disabled = s.current === 0;
  $('next-btn').disabled = s.current === s.items.length - 1;

  renderNavigator();
  updateStatus();
  if (focusOptions) (fieldset.querySelector('input:checked') || fieldset.querySelector('input'))?.focus();
}

function renderNavigator() {
  const s = state.session;
  const list = $('navigator');
  list.replaceChildren(
    ...s.items.map((it, i) => {
      const answered = !!s.responses[it.id];
      const flagged = !!s.flagged[it.id];
      const desc = [`Question ${i + 1}`, answered ? 'answered' : 'not answered', flagged ? 'flagged' : null].filter(Boolean).join(', ');
      return el(
        'li',
        {},
        el('button', {
          type: 'button',
          class: [answered ? 'answered' : '', flagged ? 'flagged' : ''].join(' ').trim() || null,
          'aria-label': desc,
          'aria-current': i === s.current ? 'true' : null,
          text: String(i + 1),
          onclick: () => goTo(i),
        }),
      );
    }),
  );
}

function updateStatus() {
  const s = state.session;
  const answered = core.answeredCount(s);
  const total = s.items.length;
  const pctDone = total ? Math.round((answered / total) * 100) : 0;
  $('answered-count').textContent = `${answered} of ${total}`;
  $('progress').setAttribute('aria-valuenow', String(pctDone));
  $('progress').setAttribute('aria-valuetext', `${answered} of ${total} answered`);
  $('progress-fill').style.width = `${pctDone}%`;

  const ok = core.canSubmit(s);
  const threshold = core.submitThreshold(s);
  const btn = $('submit-btn');
  btn.setAttribute('aria-disabled', String(!ok));
  const wrap = $('submit-wrap');
  if (ok) {
    delete wrap.dataset.tip;
    const left = total - answered;
    $('submit-help').textContent = left
      ? `${left} unanswered question${left === 1 ? '' : 's'} will be excluded from scoring.`
      : 'All questions answered.';
  } else {
    const tip = `Answer at least ${threshold} questions to submit (${threshold - answered} more to go).`;
    wrap.dataset.tip = tip;
    $('submit-help').textContent = tip;
  }
}

function recordAnswer(displayLetter) {
  const s = state.session;
  const { it } = currentQuestion();
  s.responses[it.id] = core.originalLetterFor(it.perm, displayLetter);
  storage.save(s);
  renderNavigator();
  updateStatus();
}

function selectByKey(index) {
  const input = $('options').querySelectorAll('input[type="radio"]')[index];
  if (!input) return;
  input.checked = true;
  recordAnswer(input.value);
}

function goTo(i, opts) {
  const s = state.session;
  if (i < 0 || i >= s.items.length) return;
  s.current = i;
  storage.save(s);
  renderQuestion(opts);
}

function toggleFlag() {
  const s = state.session;
  const { it } = currentQuestion();
  if (s.flagged[it.id]) delete s.flagged[it.id];
  else s.flagged[it.id] = true;
  storage.save(s);
  renderQuestion();
}

function trySubmit() {
  const s = state.session;
  if (!core.canSubmit(s)) return;
  const left = s.items.length - core.answeredCount(s);
  if (left > 0) {
    $('confirm-text').textContent = `You have ${left} unanswered question${left === 1 ? '' : 's'}. ${left === 1 ? 'It' : 'They'} will be excluded from scoring and listed separately in the report.`;
    $('confirm-dialog').showModal();
    return;
  }
  finish();
}

function finish() {
  const s = state.session;
  s.submittedAt = new Date().toISOString();
  storage.save(s);
  showReport(s);
}

function onKey(e) {
  if ($('quiz').hidden || $('confirm-dialog').open) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'radio'))) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const idx = ['1', '2', '3', '4'].indexOf(key) >= 0 ? ['1', '2', '3', '4'].indexOf(key) : ['a', 'b', 'c', 'd'].indexOf(key);
  const inOptions = $('options').contains(document.activeElement);
  if (idx >= 0) {
    e.preventDefault();
    selectByKey(idx);
  } else if (key === 'ArrowLeft') {
    e.preventDefault();
    goTo(state.session.current - 1, { focusOptions: inOptions });
  } else if (key === 'ArrowRight') {
    e.preventDefault();
    goTo(state.session.current + 1, { focusOptions: inOptions });
  } else if (key === 'f') {
    e.preventDefault();
    toggleFlag();
  }
}

// ---------- Report ----------

function showReport(session) {
  state.session = session;
  state.report = core.scoreSession(session, state.lookup, state.taxonomy);
  renderReport();
  show('report');
  $('report-title').focus();
}

function tile(label, value, note) {
  return el('div', { class: 'tile' }, el('p', { class: 'tile-label', text: label }), el('p', { class: 'tile-value', text: value }), el('p', { class: 'tile-note', text: note }));
}

function renderReport() {
  const s = state.session;
  const r = state.report;
  const tax = state.taxonomy;
  const target = Math.round(r.target * 100);

  const meta = [
    `Bank v${s.bankVersion}`,
    `${r.answered} of ${r.total} answered`,
    `seed ${s.seed}`,
    s.submittedAt ? `submitted ${new Date(s.submittedAt).toLocaleString()}` : null,
    s.mode === 'focus' ? `focused on ${s.focusDomains.map((d) => `D${d}`).join(', ')}` : null,
  ];
  $('report-meta').textContent = meta.filter(Boolean).join(' · ');

  $('score-tiles').replaceChildren(
    tile('Raw score', fmtPct(r.overall.pct), `${r.overall.correct} of ${r.overall.n} correct`),
    tile('Difficulty-weighted', fmtPct(r.overall.weightedPct), 'Easy 1, medium 1.5, hard 2 points'),
    tile('Exam-weight adjusted', fmtPct(r.examWeighted), 'Each domain counted by its exam weight'),
    tile('Answered', `${r.answered}/${r.total}`, r.unanswered.length ? `${r.unanswered.length} unanswered, excluded` : 'None left unanswered'),
  );

  $('rule-text').replaceChildren(
    el('p', {}, el('strong', { text: 'How domains are classified. ' }),
      `Each domain gets a 95% interval: the range of true scores that fits your answers. The fewer questions you answered in a domain, the wider its interval. `),
    el('ul', { class: 'plain-list' },
      el('li', {}, el('strong', { text: 'Strength: ' }), `the whole interval is at or above ${target}%.`),
      el('li', {}, el('strong', { text: 'Weakness: ' }), `the whole interval is below ${target}%.`),
      el('li', {}, el('strong', { text: 'Adequate: ' }), `the interval crosses ${target}%, so the data cannot yet say either way.`),
      el('li', {}, el('strong', { text: 'Insufficient data: ' }), `fewer than ${r.minN} questions answered in the domain. It is never called a strength or a weakness.`),
    ),
    el('p', { text: `${target}% is a study target chosen for this tool, not an official passing mark.` }),
  );

  const tbody = $('domain-table').querySelector('tbody');
  tbody.replaceChildren(
    ...Object.entries(r.domains).map(([d, x]) =>
      el('tr', {},
        el('th', { scope: 'row', text: domainLabel(d) }),
        el('td', { class: 'num', text: String(x.n) }),
        el('td', { class: 'num', text: x.n ? `${x.correct} (${fmtPct(x.pct)})` : '–' }),
        el('td', { class: 'num', text: fmtCI(x.ci) }),
        el('td', { class: 'num', text: fmtPct(x.weightedPct) }),
        el('td', {}, statusBadge(x.status)),
      ),
    ),
  );

  renderBarChart(
    $('domain-chart'),
    Object.entries(r.domains).map(([d, x]) => {
      const insufficient = x.status === 'insufficient';
      const valueText = !x.n ? 'not answered' : `${fmtPct(x.pct)} (n=${x.n})${insufficient ? ', insufficient data' : ''}`;
      return {
        label: domainLabel(d),
        value: x.n ? x.pct : null,
        ci: x.n ? x.ci : null,
        muted: insufficient,
        valueText,
        description: x.n
          ? `${domainLabel(d)}: ${fmtPct(x.pct)} correct, 95% interval ${fmtCI(x.ci)}, ${x.n} answered, ${STATUS[x.status].label}`
          : `${domainLabel(d)}: no questions answered`,
      };
    }),
    { target: r.target },
  );

  renderBarChart(
    $('difficulty-chart'),
    core.DIFFICULTIES.map((k) => {
      const x = r.byDifficulty[k];
      return {
        label: capitalize(k),
        value: x.n ? x.pct : null,
        ci: x.n ? x.ci : null,
        muted: false,
        valueText: x.n ? `${fmtPct(x.pct)} (n=${x.n})` : 'not answered',
        description: x.n ? `${capitalize(k)}: ${fmtPct(x.pct)} correct, 95% interval ${fmtCI(x.ci)}, ${x.n} answered` : `${capitalize(k)}: none answered`,
      };
    }),
  );

  renderGuidance();
  renderUnanswered();

  const domainFilter = $('filter-domain');
  domainFilter.replaceChildren(el('option', { value: '', text: 'All domains' }), ...Object.keys(tax.domains).map((d) => el('option', { value: d, text: domainLabel(d) })));
  $('filter-kind').value = 'missed-flagged';
  $('filter-difficulty').value = '';
  renderReview();

  const weak = r.weakDomains;
  $('retake-btn').setAttribute('aria-disabled', String(!weak.length));
  $('retake-help').textContent = weak.length
    ? `The retake draws about 60% of its questions from ${weak.map((d) => `D${d}`).join(', ')}.`
    : 'No domain is classified as a Weakness, so a focused retake is not available. Start a new session instead.';
}

function renderGuidance() {
  const r = state.report;
  const box = $('guidance');
  if (!r.guidance.length) {
    const adequate = Object.entries(r.domains)
      .filter(([, x]) => x.status === 'adequate')
      .sort((a, b) => a[1].pct - b[1].pct)
      .slice(0, 3)
      .map(([d]) => domainLabel(d));
    box.replaceChildren(
      el('p', { text: 'No domain is a clear weakness in this session.' }),
      adequate.length
        ? el('p', { text: `Lowest-scoring domains with too little evidence to call: ${adequate.join('; ')}. A longer session narrows their intervals.` })
        : null,
    );
    return;
  }
  box.replaceChildren(
    ...r.guidance.map((g) => {
      const x = r.domains[g.domain];
      return el('div', { class: 'guidance-card' },
        el('h3', {}, el('span', { class: 'status-icon', 'aria-hidden': 'true', text: '! ' }), `${domainLabel(g.domain)}: ${x.correct} of ${x.n} correct`),
        el('p', { class: 'hint', text: 'Missed subtopics' }),
        el('ul', {}, ...g.missedSubtopics.map((m) => el('li', { text: `${m.name} (${m.count} missed)` }))),
        el('p', { class: 'hint', text: 'Study focus' }),
        el('ul', {}, ...g.focus.map((f) => el('li', { text: f }))),
        g.concepts.length ? el('p', {}, el('strong', { text: 'Concepts to review: ' }), g.concepts.join('; ')) : null,
      );
    }),
  );
}

function renderUnanswered() {
  const r = state.report;
  $('unanswered-block').hidden = !r.unanswered.length;
  const order = new Map(state.session.items.map((it, i) => [it.id, i + 1]));
  $('unanswered-list').replaceChildren(
    ...r.unanswered.map((row) =>
      el('li', { text: `Question ${order.get(row.q.id)}: D${row.q.domain}, ${row.q.subtopic} (${row.q.difficulty})${row.flagged ? ', flagged' : ''}` }),
    ),
  );
}

function renderReview() {
  const r = state.report;
  const kind = $('filter-kind').value;
  const dom = $('filter-domain').value;
  const diff = $('filter-difficulty').value;
  const order = new Map(state.session.items.map((it, i) => [it.id, i + 1]));
  const all = [...r.rows, ...r.unanswered].sort((a, b) => order.get(a.q.id) - order.get(b.q.id));
  const rows = all.filter((row) => {
    const missed = row.response && !row.correct;
    if (kind === 'missed' && !missed) return false;
    if (kind === 'flagged' && !row.flagged) return false;
    if (kind === 'missed-flagged' && !(missed || row.flagged)) return false;
    if (dom && String(row.q.domain) !== dom) return false;
    if (diff && row.q.difficulty !== diff) return false;
    return true;
  });
  $('review-count').textContent = `Showing ${rows.length} question${rows.length === 1 ? '' : 's'}.`;
  $('review-list').replaceChildren(...rows.map((row) => reviewItem(row, order.get(row.q.id))));
}

function reviewItem(row, number) {
  const { q, item } = row;
  const view = core.viewQuestion(q, item.perm);
  const chosen = core.displayLetterFor(item.perm, row.response);
  const outcome = !row.response ? 'Unanswered' : row.correct ? 'Correct' : 'Missed';
  const stem = el('p', { class: 'stem' });
  richText(stem, q.stem);
  const options = el('ul', { class: 'review-options' },
    ...view.options.map((o) => {
      const isCorrect = o.letter === view.correct;
      const isChosen = o.letter === chosen;
      const text = el('span');
      richText(text, o.text);
      return el('li', { class: [isCorrect ? 'is-correct' : '', isChosen ? 'is-chosen' : ''].join(' ').trim() || null },
        el('strong', { text: `${o.letter}. ` }), text,
        isChosen ? el('span', { class: 'marker marker-chosen', text: '← your answer' }) : null,
        isCorrect ? el('span', { class: 'marker marker-correct', text: '✓ correct answer' }) : null,
        !isCorrect ? el('span', { class: 'why', text: `Why not: ${view.rationales[o.letter]}` }) : null,
      );
    }),
  );
  return el('li', { class: 'review-item' },
    el('div', { class: 'review-tags' },
      el('span', { class: 'tag tag-strong', text: `Question ${number}` }),
      el('span', { class: 'tag tag-strong', text: outcome }),
      row.flagged ? el('span', { class: 'tag tag-strong', text: '⚑ Flagged' }) : null,
      el('span', { class: 'tag', text: domainLabel(q.domain) }),
      el('span', { class: 'tag', text: q.subtopic }),
      el('span', { class: 'tag', text: capitalize(q.difficulty) }),
    ),
    stem,
    options,
    el('p', { text: `Your answer: ${chosen || 'none'}. Correct answer: ${view.correct}.` }),
    el('p', { class: 'review-expl' }, el('strong', { text: `Why ${view.correct} is correct: ` }), q.explanation),
    el('p', { class: 'hint', text: `Concept: ${q.references_topic} · ${q.id}` }),
  );
}

function exportJSON() {
  const data = core.exportResults(state.session, state.report, { exported_at: new Date().toISOString() });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `cissp-diagnostic-${(state.session.submittedAt || '').slice(0, 10)}-${state.session.seed}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function retakeFocused() {
  const weak = state.report.weakDomains;
  if (!weak.length) return;
  startSession({ length: state.session.items.length, mode: 'focus', focusDomains: weak });
}

// ---------- Wiring ----------

function wire() {
  const range = $('length-range');
  const num = $('length-number');
  range.addEventListener('input', () => { num.value = range.value; });
  num.addEventListener('change', () => { num.value = String(clampLength(num.value)); range.value = num.value; });
  $('start-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startSession({ length: clampLength(num.value), seed: $('seed-input').value.trim() });
  });
  $('resume-btn').addEventListener('click', () => {
    state.session = restore(storage.load());
    if (state.session) showQuiz();
  });
  $('discard-btn').addEventListener('click', () => { storage.clear(); setupStart(); });
  $('view-last-btn').addEventListener('click', () => {
    const saved = restore(storage.load());
    if (saved) showReport(saved);
  });

  $('prev-btn').addEventListener('click', () => goTo(state.session.current - 1));
  $('next-btn').addEventListener('click', () => goTo(state.session.current + 1));
  $('flag-btn').addEventListener('click', toggleFlag);
  $('submit-btn').addEventListener('click', trySubmit);
  $('exit-btn').addEventListener('click', setupStart);
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
  $('confirm-ok').addEventListener('click', () => { $('confirm-dialog').close(); finish(); });
  document.addEventListener('keydown', onKey);

  for (const id of ['filter-kind', 'filter-domain', 'filter-difficulty']) $(id).addEventListener('change', renderReview);
  $('export-btn').addEventListener('click', exportJSON);
  $('print-btn').addEventListener('click', () => window.print());
  $('new-btn').addEventListener('click', setupStart);
  $('retake-btn').addEventListener('click', retakeFocused);
}

async function main() {
  wire();
  try {
    await loadBank();
  } catch (err) {
    $('loading').hidden = true;
    const box = $('load-error');
    box.hidden = false;
    box.textContent = `The question bank could not be loaded (${err.message}). If you opened index.html directly from disk, serve the folder over HTTP instead, for example: python -m http.server`;
    return;
  }
  const saved = restore(storage.load());
  if (saved && !saved.submittedAt) {
    state.session = saved;
    showQuiz();
  } else {
    setupStart();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
