// Pure, DOM-free logic shared by the app and the Node unit tests.

export const LETTERS = ['A', 'B', 'C', 'D'];
export const MIN_SUBMIT = 20;
export const MIN_SESSION = 20;
export const MAX_SESSION = 100;
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

// ---------- Seedable PRNG ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function newSeedString(rng = Math.random) {
  return Math.floor(rng() * 0xffffffff).toString(36).padStart(7, '0');
}

export function shuffle(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- Allocation and stratified sampling ----------

/**
 * Split `total` across keys in proportion to `weights`, never exceeding `caps`.
 * Slots a capped key cannot take are redistributed proportionally among the rest.
 * Uses largest remainders, so results are deterministic and sum exactly to
 * min(total, sum of caps).
 */
export function allocate(total, weights, caps) {
  const keys = Object.keys(weights);
  const cap = (k) => (caps && k in caps ? caps[k] : Infinity);
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  let remaining = Math.min(total, keys.reduce((s, k) => s + cap(k), 0));
  while (remaining > 0) {
    const active = keys.filter((k) => out[k] < cap(k));
    if (!active.length) break;
    const wsum = active.reduce((s, k) => s + Math.max(0, weights[k]), 0);
    const share = (k) => (wsum > 0 ? Math.max(0, weights[k]) / wsum : 1 / active.length);
    const rows = active.map((k) => {
      const ideal = remaining * share(k);
      const give = Math.min(Math.floor(ideal), cap(k) - out[k]);
      return { k, give, frac: ideal - Math.floor(ideal) };
    });
    let given = 0;
    for (const r of rows) {
      out[r.k] += r.give;
      given += r.give;
    }
    let left = remaining - given;
    const byRemainder = rows
      .filter((r) => out[r.k] < cap(r.k))
      .sort((a, b) => b.frac - a.frac || weights[b.k] - weights[a.k] || keys.indexOf(a.k) - keys.indexOf(b.k));
    for (const r of byRemainder) {
      if (left <= 0) break;
      out[r.k] += 1;
      left -= 1;
    }
    const progress = remaining - left;
    remaining = left;
    if (progress === 0) break;
  }
  return out;
}

export function domainWeights(taxonomy) {
  return Object.fromEntries(Object.entries(taxonomy.domains).map(([d, spec]) => [d, spec.weight]));
}

/** Oversample weak domains: they share `share` of the session, split by their exam weights. */
export function focusWeights(baseWeights, weakDomains, share = 0.6) {
  const weak = new Set(weakDomains.map(String));
  const keys = Object.keys(baseWeights);
  const weakSum = keys.filter((k) => weak.has(k)).reduce((s, k) => s + baseWeights[k], 0);
  const otherSum = keys.filter((k) => !weak.has(k)).reduce((s, k) => s + baseWeights[k], 0);
  if (!weakSum || !otherSum) return { ...baseWeights };
  return Object.fromEntries(
    keys.map((k) => [k, weak.has(k) ? (share * baseWeights[k]) / weakSum : ((1 - share) * baseWeights[k]) / otherSum]),
  );
}

export function maxSessionLength(bankSize) {
  return Math.min(MAX_SESSION, bankSize);
}

/**
 * Stratified random draw without replacement: domain quotas follow `weights`,
 * difficulty quotas inside each domain follow `mix`. Short strata give what
 * they have and the shortfall is redistributed.
 */
export function sampleQuestions(bank, n, { weights, mix, rng }) {
  const byDomain = new Map();
  for (const q of bank) {
    const d = String(q.domain);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(q);
  }
  const w = { ...weights };
  for (const d of byDomain.keys()) if (!(d in w)) w[d] = 0;
  const caps = Object.fromEntries(Object.keys(w).map((d) => [d, (byDomain.get(d) || []).length]));
  const domainQuota = allocate(Math.min(n, bank.length), w, caps);

  const picked = [];
  for (const d of Object.keys(w)) {
    const pool = byDomain.get(d) || [];
    if (!domainQuota[d]) continue;
    const strata = Object.fromEntries(DIFFICULTIES.map((k) => [k, []]));
    for (const q of pool) (strata[q.difficulty] || (strata[q.difficulty] = [])).push(q);
    const diffCaps = Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, v.length]));
    const diffWeights = Object.fromEntries(Object.keys(strata).map((k) => [k, mix[k] ?? 0]));
    const quota = allocate(domainQuota[d], diffWeights, diffCaps);
    for (const [k, count] of Object.entries(quota)) {
      picked.push(...shuffle(strata[k], rng).slice(0, count));
    }
  }
  return shuffle(picked, rng);
}

// ---------- Option shuffling and answer remapping ----------

/** perm[i] is the original letter shown at display position LETTERS[i]. */
export function makePermutation(rng) {
  return shuffle(LETTERS, rng);
}

export function displayLetterFor(perm, originalLetter) {
  const i = perm.indexOf(originalLetter);
  return i < 0 ? null : LETTERS[i];
}

export function originalLetterFor(perm, displayLetter) {
  const i = LETTERS.indexOf(displayLetter);
  return i < 0 ? null : perm[i];
}

export function viewQuestion(q, perm) {
  const options = perm.map((orig, i) => ({ letter: LETTERS[i], original: orig, text: q.options[orig] }));
  const rationales = {};
  for (const o of options) {
    if (o.original !== q.answer) rationales[o.letter] = q.distractor_rationales[o.original];
  }
  return { options, correct: displayLetterFor(perm, q.answer), rationales };
}

// ---------- Sessions ----------

export function createSession(bank, taxonomy, { length, seed, mode = 'standard', focusDomains = [], bankVersion }) {
  const seedText = String(seed);
  const rng = mulberry32(seedFromString(seedText));
  let weights = domainWeights(taxonomy);
  if (mode === 'focus' && focusDomains.length) weights = focusWeights(weights, focusDomains);
  const n = Math.max(0, Math.min(length, maxSessionLength(bank.length)));
  const chosen = sampleQuestions(bank, n, { weights, mix: taxonomy.difficulty_mix, rng });
  return {
    schema: 1,
    seed: seedText,
    bankVersion,
    mode,
    focusDomains: focusDomains.map(String),
    items: chosen.map((q) => ({ id: q.id, perm: makePermutation(rng) })),
    responses: {},
    flagged: {},
    current: 0,
    startedAt: new Date().toISOString(),
    submittedAt: null,
  };
}

export function answeredCount(session) {
  return session.items.filter((it) => session.responses[it.id]).length;
}

export function submitThreshold(session) {
  return Math.min(MIN_SUBMIT, session.items.length);
}

export function canSubmit(session) {
  return session.items.length > 0 && answeredCount(session) >= submitThreshold(session);
}

// ---------- Statistics and scoring ----------

export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function classify(n, ci, { target = 0.7, minN = 4 } = {}) {
  if (n < minN || !ci) return 'insufficient';
  if (ci[0] >= target) return 'strength';
  if (ci[1] < target) return 'weakness';
  return 'adequate';
}

function tally(rows, diffWeights) {
  const n = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const wTotal = rows.reduce((s, r) => s + (diffWeights[r.q.difficulty] ?? 1), 0);
  const wCorrect = rows.reduce((s, r) => s + (r.correct ? diffWeights[r.q.difficulty] ?? 1 : 0), 0);
  return {
    n,
    correct,
    pct: n ? correct / n : null,
    ci: wilson(correct, n),
    weightedPct: wTotal ? wCorrect / wTotal : null,
  };
}

/**
 * Score a submitted session. `lookup` maps question id to question.
 * Unanswered items are excluded from every score and returned separately.
 */
export function scoreSession(session, lookup, taxonomy) {
  const target = taxonomy.target_line ?? 0.7;
  const minN = taxonomy.min_domain_n ?? 4;
  const diffWeights = taxonomy.difficulty_weights;
  const rows = [];
  const unanswered = [];
  for (const it of session.items) {
    const q = lookup.get(it.id);
    if (!q) continue;
    const response = session.responses[it.id] || null;
    const row = { q, item: it, response, correct: response === q.answer, flagged: !!session.flagged[it.id] };
    if (response) rows.push(row);
    else unanswered.push(row);
  }

  const overall = tally(rows, diffWeights);
  const domains = {};
  for (const [d, spec] of Object.entries(taxonomy.domains)) {
    const t = tally(rows.filter((r) => String(r.q.domain) === d), diffWeights);
    domains[d] = { ...t, name: spec.name, weight: spec.weight, status: classify(t.n, t.ci, { target, minN }) };
  }
  const answeredDomains = Object.values(domains).filter((x) => x.n > 0);
  const wsum = answeredDomains.reduce((s, x) => s + x.weight, 0);
  const examWeighted = wsum ? answeredDomains.reduce((s, x) => s + x.weight * x.pct, 0) / wsum : null;

  const byDifficulty = Object.fromEntries(
    DIFFICULTIES.map((k) => [k, tally(rows.filter((r) => r.q.difficulty === k), diffWeights)]),
  );

  const guidance = [];
  for (const [d, x] of Object.entries(domains)) {
    if (x.status !== 'weakness') continue;
    const missed = rows.filter((r) => String(r.q.domain) === d && !r.correct);
    const counts = new Map();
    for (const r of missed) counts.set(r.q.subtopic, (counts.get(r.q.subtopic) || 0) + 1);
    const subtopics = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const catalog = taxonomy.domains[d].subtopics || {};
    const focus = [];
    for (let round = 0; focus.length < 3 && round < 3; round++) {
      for (const [name] of subtopics) {
        const line = (catalog[name] || [])[round];
        if (line && focus.length < 3 && !focus.includes(line)) focus.push(line);
      }
    }
    guidance.push({
      domain: d,
      name: x.name,
      missedSubtopics: subtopics.map(([name, count]) => ({ name, count })),
      concepts: [...new Set(missed.map((r) => r.q.references_topic))],
      focus,
    });
  }

  return {
    answered: rows.length,
    total: session.items.length,
    overall,
    examWeighted,
    domains,
    byDifficulty,
    guidance,
    weakDomains: guidance.map((g) => g.domain),
    rows,
    unanswered,
    missed: rows.filter((r) => !r.correct),
    target,
    minN,
  };
}

export function exportResults(session, report, meta = {}) {
  const round = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
  const itemRows = [...report.rows, ...report.unanswered];
  return {
    tool: 'CISSP Practice Diagnostic (unofficial)',
    bank_version: session.bankVersion,
    seed: session.seed,
    mode: session.mode,
    focus_domains: session.focusDomains,
    started_at: session.startedAt,
    submitted_at: session.submittedAt,
    ...meta,
    scores: {
      answered: report.answered,
      total: report.total,
      raw_pct: round(report.overall.pct),
      difficulty_weighted_pct: round(report.overall.weightedPct),
      exam_weighted_pct: round(report.examWeighted),
    },
    domains: Object.fromEntries(
      Object.entries(report.domains).map(([d, x]) => [
        d,
        { name: x.name, n: x.n, correct: x.correct, pct: round(x.pct), ci95: x.ci && x.ci.map(round), weighted_pct: round(x.weightedPct), status: x.status },
      ]),
    ),
    by_difficulty: Object.fromEntries(Object.entries(report.byDifficulty).map(([k, x]) => [k, { n: x.n, correct: x.correct, pct: round(x.pct) }])),
    items: session.items
      .map((it) => itemRows.find((r) => r.item.id === it.id))
      .filter(Boolean)
      .map((r) => ({
        id: r.q.id,
        domain: r.q.domain,
        subtopic: r.q.subtopic,
        difficulty: r.q.difficulty,
        your_answer: r.response,
        correct_answer: r.q.answer,
        correct: r.response ? r.correct : null,
        flagged: r.flagged,
      })),
  };
}

// ---------- Text helpers ----------

/** Split text on **emphasis** markers into [{text, strong}] runs (no HTML parsing). */
export function emphasisRuns(text) {
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), strong: false });
    runs.push({ text: m[1], strong: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last), strong: false });
  return runs;
}
