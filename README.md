# CISSP Practice Diagnostic

> **Unofficial practice tool. Not affiliated with or endorsed by ISC2. CISSP is a registered mark of ISC2.**

A free, static practice exam that draws up to 100 random questions from an original question bank, then produces a diagnostic report of strengths and weaknesses across the eight CISSP domains, with a review of every missed question.

**Live site:** https://rickpack.github.io/cissp-practice-quiz/

Results are for study planning only. They do not predict your result on the real exam.

## What it does

- **Session length** from 20 to min(100, bank size), drawn by a stratified random sample that follows the 2024 domain weights and a 30/45/25 easy/medium/hard mix. If a domain or difficulty runs short, the sampler takes what exists and redistributes the rest.
- **Option order is shuffled** per question, and sessions are reproducible with an optional seed.
- **One question at a time**, with previous/next, flag for review, a progress bar, keyboard shortcuts (`1`–`4` or `A`–`D`, arrow keys, `F`), and no feedback until the end.
- **Submit and Finish** unlocks after 20 answers. Unanswered questions are excluded from scoring and listed separately.
- **Progress is saved** in your browser (localStorage), so a refresh does not lose your place. Nothing is sent anywhere; there is no backend.
- **Works offline** after the first visit.

### The diagnostic report

- Raw score, a difficulty-weighted score (easy 1, medium 1.5, hard 2), and an exam-weight-adjusted score.
- A per-domain table with answered count, percent correct, a Wilson 95% confidence interval, and difficulty-weighted percent.
- Each domain is classified by comparing its interval to a 70% study target:
  - **Strength**: the whole interval is at or above 70%.
  - **Weakness**: the whole interval is below 70%.
  - **Adequate**: the interval crosses 70%.
  - **Insufficient data**: fewer than 4 questions answered in the domain. Never labeled a strength or weakness.
- Charts of percent correct by domain (with interval whiskers and the target line) and by difficulty.
- Study guidance for each Weakness domain: missed subtopics, concrete focus areas, and concepts to review.
- A review of missed and flagged questions, filterable by domain and difficulty, showing your answer, the correct answer, the explanation, and why each distractor is wrong.
- JSON export, a print-friendly layout, and a "Retake focusing on weak domains" option that draws about 60% of the next session from Weakness domains.

## Run locally

The site is plain HTML, CSS, and JavaScript with no build step. It uses ES modules, so serve it over HTTP instead of opening the file directly:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

### Tests

```sh
npm test                                            # JS unit tests (Node 20+, no dependencies)
python -m pip install -r validation/requirements.txt
python validation/validate.py                       # bank validator; writes validation/report.md
```

Unit tests cover sampling proportions and graceful degradation, answer remapping after shuffling, the 20-answer gate, scoring, and the Wilson interval math. They run against synthetic banks of 80, 250, and 1,000 questions, plus a 1,000-session simulation that checks per-domain draw proportions stay within ±3 points of the targets.

## Question bank

The bank lives in `data/`:

| File | Purpose |
|---|---|
| `data/schema.json` | JSON Schema for a batch file (an array of questions) |
| `data/taxonomy.json` | Domain names, exam weights, v1.0 targets, difficulty mix, and the controlled subtopic list with study focus areas |
| `data/manifest.json` | Bank version and the list of batch files the app loads |
| `data/batches/D{n}_{k}.json` | Batch files, at most 50 questions each |

Every question is original. None are reproduced or paraphrased from ISC2 materials, official study guides, or commercial question banks. Scenarios use generic fictional organizations only.

Each question has an `id` (for example `D3-0042`), `domain`, `domain_name`, `subtopic` (from the taxonomy), `difficulty`, `type` (`knowledge`, `application`, or `managerial_best_first_most`), `stem`, `options` A–D, `answer`, `explanation`, `distractor_rationales` for the three wrong letters, `references_topic` (a concept name), and `version`.

### Add and validate a batch

1. Write the new file, for example `data/batches/D4_3.json`, following `data/schema.json`. Use the next unused IDs for that domain and subtopics listed in `data/taxonomy.json`.
2. Stage-check it before listing it: `python validation/validate.py --include data/batches/D4_3.json`
3. Fix every hard failure. Hard failures are schema errors, duplicate IDs, manifest mismatches, all/none-of-the-above options, rationale letters that don't match the key, unknown subtopics, and near-duplicate stems (TF-IDF cosine above 0.85).
4. Review the warnings in `validation/report.md`: answer-letter balance (20–30% per letter once the bank has 200+ questions), how often the correct answer is the longest option (limit 35%), and the managerial-question share (target 35%+).
5. Add the file to `data/manifest.json` with its `domain` and `count`, bump `bank_version`, re-run the validator, and commit the batch, manifest, and report together. No code changes are needed.

### Independent answer-key audit (Colab)

`validation/validate_bank.ipynb` runs the same validator in Google Colab and adds an optional audit: a Claude model answers each question **without** seeing the key, explanation, or rationales. Items where the model disagrees with the key, answers with low confidence, thinks another option is also defensible, or notes a flaw in the item are written to `validation/flags.csv` for human review.

1. Open the notebook in Colab: https://colab.research.google.com/github/RickPack/cissp-practice-quiz/blob/main/validation/validate_bank.ipynb
2. Add your Anthropic API key in **Colab Secrets** (key icon) as `ANTHROPIC_API_KEY` and allow notebook access. Never paste the key into a cell or commit it.
3. Set `MODEL` (default `claude-sonnet-5`), `TARGET` (`"all"` or one batch file), and `MODE` (`"batch"` is half price and asynchronous; `"sync"` is immediate and resumable). Try `LIMIT = 5` first.
4. Run all cells, download `flags.csv`, and copy it into `validation/`.
5. For each flagged row, correct or replace the question and record what you did in the `resolution` column. Re-run the validator and commit.

The same audit runs locally with `ANTHROPIC_API_KEY` set in your environment: `python validation/audit.py --target data/batches/D4_3.json` (install `validation/requirements-audit.txt` first).

## Repository layout

```
index.html, app.js, styles.css   the site
lib/core.js                      sampling, remapping, scoring, statistics (shared with tests)
lib/charts.js                    inline SVG charts
sw.js                            offline cache
data/                            question bank (CC BY 4.0)
validation/                      validate.py, audit.py, Colab notebook, report.md, flags.csv
tests/                           Node unit tests
.github/workflows/ci.yml         validate, test, and deploy to GitHub Pages from main
```

## Continuous integration

Every push runs the bank validator and the unit tests. Pushes to `main` that pass both are deployed to GitHub Pages. Workflow actions are pinned to full commit SHAs, and Python dependencies are pinned to exact versions.

## Licensing

- **Code** (everything outside `data/`) is under the [MIT License](LICENSE).
- **Question bank** (`data/`) is under [Creative Commons Attribution 4.0 International](data/LICENSE). You may share and adapt the questions, including commercially, if you give appropriate credit and indicate changes.

The split keeps the code freely reusable while making sure anyone who reuses the questions credits their source.

## Disclaimer

Unofficial practice tool. Not affiliated with or endorsed by ISC2. CISSP is a registered mark of ISC2. The questions are original practice material and have not been reviewed by ISC2. Scores are for study planning only and are not predictive of exam results.
