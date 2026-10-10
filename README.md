# CISSP Practice Diagnostic

> **Unofficial practice tool. Not affiliated with or endorsed by ISC2. CISSP is a registered mark of ISC2.**

A free, static practice exam that draws up to 100 random questions from an original question bank, then produces a diagnostic report of strengths and weaknesses across the eight CISSP domains, with a review of every missed question.

**Live site:** https://rickpack.github.io/cissp-practice-quiz/

Results are for study planning only. They do not predict your result on the real exam.

## What it does

- **Session length** from 20 to min(100, bank size), drawn by a stratified random sample that follows the 2024 domain weights and a 30/45/25 easy/medium/hard mix. If a domain or difficulty runs short, the sampler takes what exists and redistributes the rest.
- **Option order is shuffled** per question, and sessions are reproducible with an optional seed.
- **One question at a time**, with previous/next, flag for review, a progress bar, keyboard shortcuts (`1`–`4` or `A`–`D`, arrow keys, `F`, `R`, `V`), and no feedback until the end.
- **Submit and Finish** unlocks after 20 answers. Unanswered questions are excluded from scoring and listed separately.
- **Progress is saved** in your browser (localStorage), so a refresh does not lose your place or your answers. A resumed session opens on the question you were on if it is unanswered, otherwise on the next unanswered one (wrapping to the first unanswered one). Nothing is sent to this site; there is no backend. (The optional voice feature has its own privacy note below.)
- **Works offline** after the first visit.
- **Read aloud** (optional): Read aloud / Pause / Stop buttons, an auto-read toggle (off by default), and `R` to start or stop. See below.
- **Voice answers** (optional, off by default): speak A–D, confirm by voice, and use voice commands. See below.

### Read aloud

Uses the browser's built-in speech synthesis. No network calls, keys, or dependencies; if the browser has no speech support, the controls are hidden.

- Speaks the question number, the stem, then "Option A", its text, "Option B", and so on, in the order shown on screen. It never speaks whether an answer is correct during the quiz.
- Voice (English, local voices first), speed (0.75x to 1.75x), and volume are saved in your browser. Your on/off choices are remembered across reloads (auto-read, and for voice: enabled, hands-free, and read-back confirmation); only those booleans are stored, never audio or text. Browsers block speech and the microphone until you tap or press a key, so after a reload nothing is spoken or listened to until your first tap or key press, and the page says so.
- Speech stops when you change question, submit, leave the screen, or close the page.
- In the report's question review, each question has a **Read explanation** button. Explanations are spoken only there, after submission.
- Browser notes: voice lists load asynchronously, so the picker can fill in a moment after the page loads. Chrome cuts off long utterances, so text is spoken in sentence-sized chunks. Voices, and whether some are online-only, depend on the browser and operating system.
- Pronunciations: `lib/pronunciations.js` holds `[written, spoken]` pairs applied only to the spoken text. To add one, append a pair such as `['EDR', 'E D R']`; matching is case-sensitive and whole-word, and longer phrases go before shorter words they contain. Add a test case in `tests/speech.test.mjs` if the entry is unusual.

### Immediate feedback (optional)

Off by default, so the practice stays blind and results appear only in the report. Tick **Show feedback after each answer** and each answered question shows Correct or Not correct, the correct answer, the explanation, and why your choice was wrong. With auto-read or hands-free on, a short verdict is also spoken ("Correct." or "Not correct. The correct answer is C."), and hands-free waits for it to finish before moving on. Changing an answer is still allowed and updates the feedback; scoring uses your final answer. The choice is remembered across reloads and does not change scoring or the report.

### Voice answers

Optional and off by default. Uses the browser's built-in speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`). No dependencies, backend, or API keys. If the browser has no speech recognition, the voice controls are hidden and typing and tapping work as before.

**Privacy.** In some browsers (Chrome and other Chromium browsers, and Safari), the audio is sent to the browser vendor's cloud service for transcription. This site cannot control that, and nothing is sent to this site. Voice is off on your first visit and stays off until you click **Enable voice answers**, which sits next to this notice. After that the choice is remembered; **Turn voice off** forgets it. The browser then asks for microphone permission when you first speak. If you refuse, the page says so and carries on with tapping and typing.

- **Push-to-talk:** press the **Talk** button or `V`, then say a letter. Speech is not captured until you do.
- **Hands-free** (toggle, needs read-aloud support): reads the question and options aloud, then listens once for an answer. The mic never opens while speech is playing or paused. It opens a quarter second after the last utterance ends.
- **Confirmation:** a heard letter is read back ("You said B. Say yes to confirm, or say a different letter."). Say yes, confirm, or correct to save it; no or change to start over; a different letter to replace it; skip to move on. The heard text and parsed letter are also shown on screen. An answer is recorded only after confirmation, through the same code path as a tap.
- **Answer while it speaks (optional, off by default):** tick **Let me say yes or no while it is still speaking** and the mic stays open during the confirmation prompt, so "yes" or "no" cuts it off and acts at once. This is the one exception to "the mic never listens while speech is playing". Use headphones: on speakers the mic can hear the prompt itself. To limit that, the prompt is shortened to "You said B. Yes or no?" and unclear sounds heard while it plays are ignored. The question itself is never read with the mic open.
- **Skip the read-back (optional):** untick **Read back and confirm my answer** and a heard letter is saved at once, with nothing spoken. It is faster, but a mis-heard letter is saved too; check the on-screen "Heard" line and say another letter to replace it.
- **Typed or tapped answers keep hands-free going:** in hands-free mode, an answer entered by keyboard or tap is treated like a spoken one: the open mic closes and it moves to the next question, reads it, and listens.
- **Hands-free moves on:** once an answer is saved, hands-free goes to the next question and reads it. On the last question it says so and waits for a command such as "submit".
- **Not understood:** the app says "I didn't catch that" and listens again, up to 2 retries, then asks you to tap.
- **Commands:** `next`, `previous`, `repeat`, `flag`, `skip` (moves on, leaving the question as it is), `stop listening` (turns the mic and hands-free off), and `submit`. Submit goes through the same 20-answer gate and the same confirmation dialog as the Submit button; the dialog is always answered on screen.
- **No feedback during the quiz (by default):** the voice flow never says or shows whether an answer is correct. Feedback appears only in the report, unless you turn on **Show feedback after each answer** (see below). Even then, the voice code is never given answer data: the app hands it a prepared line to play.
- **The mic stops** immediately when you change question, submit, hide the tab, or leave the page.
- **Status:** a visible indicator shows idle, listening, or processing, and a screen-reader live region announces changes. Screen-reader users may prefer push-to-talk, since hands-free reading and a screen reader can speak over each other.
- **Accepted answers:** letters (and mis-hearings such as "bee", "dee", "see", "sea"), "alpha / bravo / charlie / delta", "option 1" to "option 4", "first" to "fourth", "number two", and so on. Filler such as "um", "I think", and "my answer is" is ignored. The best match across the interim and alternative transcripts wins. Two different letters in one phrase ("B or C") count as unclear.

Browser support (as of v0.3; engines change, so check your own browser):

| Browser | Voice answers | Notes |
|---|---|---|
| Chrome / Edge (desktop and Android) | Yes | Speech goes to the vendor's cloud service. Sessions end on their own, so hands-free reopens the mic. |
| Safari (macOS, iOS) | Partly | Starting the mic needs a tap or key press. If hands-free cannot restart it, the page asks you to press Talk. |
| Firefox | No | No `SpeechRecognition`; the controls are hidden. |

Other quirks handled: a listen timeout, the `no-speech` error (counts as a miss), permission denial, a missing microphone, and network errors (each turns voice off with a plain message).

**How to extend the alias list.** All spoken forms live in `lib/voice-parse.js`:

- A new word for a letter: add it to `LETTER_ALIASES` (for example `B: [..., 'bea']`).
- A number word: `NUMBER_ALIASES` (counted alone or after "option", "number", and similar words in `CONTEXT_WORDS`).
- A sound-alike that is too risky alone (such as "for"): `CONTEXT_ONLY_ALIASES`.
- Spoken padding to ignore: `FILLER_PHRASES` and `FILLER_WORDS`.
- A command phrase: `COMMANDS`. Yes and no words: `CONFIRM_YES`, `CONFIRM_NO`.

Each word may map to one letter only. Add a test case in `tests/voice-parse.test.mjs`; the alias-table test fails if a word is listed under two letters. Everything the app says in the voice flow is in `MESSAGES` in `lib/voice-flow.js`, and a test checks that none of it mentions correctness.

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

Unit tests cover the voice parser (letters, homophones, aliases, filler, ambiguity), the confirmation state machine, the no-correctness-leak rule, and the controller against mocked `SpeechRecognition` and `speechSynthesis` (the mic never opens while speech plays; the mic stops on navigate, submit, and unload). They also cover sampling proportions and graceful degradation, answer remapping after shuffling, the 20-answer gate, scoring, and the Wilson interval math. They run against synthetic banks of 80, 250, and 1,000 questions, plus a 1,000-session simulation that checks per-domain draw proportions stay within ±3 points of the targets.

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
lib/speech-text.js               spoken-text builder and chunking (no DOM)
lib/pronunciations.js            acronym pronunciation map
lib/speech.js                    read-aloud controller (speechSynthesis injectable)
lib/voice-parse.js               spoken-answer parser and alias tables (no DOM)
lib/voice-flow.js                confirmation state machine and message table (no DOM)
lib/voice.js                     voice controller (SpeechRecognition injectable)
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
