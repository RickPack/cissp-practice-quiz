import { readFileSync } from 'node:fs';
import { allocate, LETTERS } from '../lib/core.js';

const root = new URL('../', import.meta.url);

export function loadJSON(relPath) {
  return JSON.parse(readFileSync(new URL(relPath, root), 'utf8'));
}

export const taxonomy = loadJSON('data/taxonomy.json');

/** Synthetic bank of `size` questions spread by domain targets and the difficulty mix. */
export function makeBank(size, { tweak } = {}) {
  const targets = Object.fromEntries(Object.entries(taxonomy.domains).map(([d, s]) => [d, s.target]));
  const perDomain = allocate(size, targets);
  const bank = [];
  let serial = 0;
  for (const [d, count] of Object.entries(perDomain)) {
    const perDiff = allocate(count, taxonomy.difficulty_mix);
    let i = 0;
    for (const [difficulty, k] of Object.entries(perDiff)) {
      for (let j = 0; j < k; j++, i++, serial++) {
        const answer = LETTERS[serial % 4];
        const q = {
          id: `D${d}-${String(i + 1).padStart(4, '0')}`,
          domain: Number(d),
          domain_name: taxonomy.domains[d].name,
          subtopic: Object.keys(taxonomy.domains[d].subtopics)[i % Object.keys(taxonomy.domains[d].subtopics).length],
          difficulty,
          type: 'knowledge',
          stem: `Synthetic question ${serial}`,
          options: Object.fromEntries(LETTERS.map((L) => [L, `Option ${L} of ${serial}`])),
          answer,
          explanation: 'Synthetic explanation.',
          distractor_rationales: Object.fromEntries(LETTERS.filter((L) => L !== answer).map((L) => [L, `Why ${L} is wrong`])),
          references_topic: 'Synthetic',
          version: '0.0',
        };
        bank.push(tweak ? tweak(q) : q);
      }
    }
  }
  return bank;
}

export function countBy(items, fn) {
  const out = {};
  for (const x of items) {
    const k = fn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
