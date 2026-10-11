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
- **Spaced review deck**: questions you miss come back after 1, 3, 7, and 14 days until you get them right. See below.
- **Commute mode** (separate study mode): eyes-free questions read aloud, answered by voice, with the verdict and explanation read straight back. Never scored. See below.
- **Python track** (second question bank): 60 questions about this site's own Python code, chosen with a **CISSP | Python** switch on the start screen. See below.

### Read aloud

Uses the browser's built-in speech synthesis. No network calls, keys, or dependencies; if the browser has no speech support, the controls are hidden.

- Speaks the question number, the stem, then "Option A", its text, "Option B", and so on, in the order shown on screen. It never speaks whether an answer is correct during the quiz.
- Voice (English, local voices first), speed (0.75x to 1.75x), and volume are saved in your browser. Your on/off choices are remembered across reloads (auto-read, and for voice: enabled, hands-free, and read-back confirmation); only those booleans are stored, never audio or text. Browsers block speech and the microphone until you tap or press a key, so after a reload nothing is spoken or listened to until your first tap or key press, and the page says so.
- Speech stops when you change question, submit, leave the screen, or close the page.
- In the report's question review, each question has a **Read explanation** button. Explanations are spoken only there, after submission.
- Browser notes: voice lists load asynchronously, so the picker can fill in a moment after the page loads. Chrome cuts off long utterances, so text is spoken in sentence-sized chunks. Voices, and whether some are online-only, depend on the browser and operating system.
- Pronunciations: `lib/pronunciations.js` holds `[written, spoken]` pairs applied only to the spoken text. To add one, append a pair such as `['EDR', 'E D R']`; matching is case-sensitive and whole-word, and longer phrases go before shorter words they contain. Add a test case in `tests/speech.test.mjs` if the entry is unusual.

### Immediate feedback (optional)

Off by default, so the practice stays blind and results appear only in the report. Tick **Show feedback after each answer** and each answered question shows Correct or Not correct, the correct answer, the explanation, and why your choice was wrong. With auto-read or hands-free on, it is also read aloud: the verdict, "The correct answer is C.", then the explanation. Hands-free waits for it to finish before moving on; press Stop or Next to cut it short. Changing an answer is still allowed and updates the feedback; scoring uses your final answer. The choice is remembered across reloads and does not change scoring or the report.

### Spaced review deck

Questions you miss come back on a schedule until you get them right.

- **What goes in:** when you submit a session, every question you answered wrongly, and every flagged question you left unanswered, is added to the deck. A question already in the deck that you miss again goes back to box 1.
- **The schedule** (Leitner boxes): a new card waits 1 day. Each correct answer on a due card moves it to the next box: 3 days, then 7, then 14. A correct answer in the last box graduates the card and removes it. A miss at any point sends it back to box 1 (1 day). Answering a card correctly before it is due changes nothing, so it cannot skip a step.
- **Reviewing:** the start screen shows "N due today" and a **Review due questions** button. It starts a normal session built only from due questions (up to 100, most overdue first), with the usual one-question-at-a-time screen, no feedback until the end, and the usual report. Submitting it updates the deck.
- **Report line:** right after you submit, the report says how many new cards were added, how many moved up, how many graduated, and how many went back to box 1. Reopening an old report does not update the deck again.
- **Clear review deck** on the start screen removes every card after a confirmation.
- **Dates:** due dates are local calendar dates (YYYY-MM-DD), so a card becomes due at midnight where you are, and daylight-saving changes do not move it. If the device clock moves backwards, dates in the future are pulled back so cards are not stranded.
- **Privacy:** the deck is stored only in this browser (localStorage key `cissp-diagnostic:review`): question IDs, a box number, and dates. No question text, answers, or scores. Nothing is sent anywhere. Corrupt or unexpected stored data is ignored, and questions no longer in the bank are dropped.
- **The deck repeats what the answer key says.** The independent answer-key audit (below) has not been run yet, so a wrong key would be drilled as if it were right.
- **Changing the intervals:** edit `INTERVALS` in `lib/review-deck.js` (days for box 1, 2, 3, ...). Add or remove entries to change the number of boxes; cards in a box past the end of a shorter list are treated as being in the last box. Update the expected list in `tests/review-deck.test.mjs`.

### Commute mode

Eyes-free study on questions you got wrong. Open it from the start screen with **Open commute mode**. The button appears only when the browser can speak (speech synthesis); voice recognition is optional.

- **A separate study mode, not a practice exam.** Here feedback is the point: after each question you hear whether you were right, the correct answer, and the explanation. It never runs inside a scored session. It does not read or change your practice session or report, and it leaves out the questions of an unfinished session so it cannot reveal their answers. The normal quiz still shows no feedback unless you opt in.
- **Queue (up to 20 per run):** review cards due today first, then questions you missed in your last submitted report and the newest cards in your review deck, then random questions to fill the run.
- **The loop:** it reads the question number, stem, and options, then listens once for A, B, C, or D. If nothing is heard for about 8 seconds, the question counts as skipped. Then it reads the verdict ("Correct." / "Not correct." / "Skipped."), "The correct answer is C.", and the explanation, and moves to the next question. The mic never listens while the question or the answer is being read.
- **Voice commands:** `repeat`, `next` or `skip` (both reveal the answer and move on), and `stop` (ends the run). Quiz-only commands such as `flag` and `submit` are not used here. If it still has not understood after 2 retries, it skips rather than asking you to tap.
- **Shared voice settings:** it uses the same privacy notice and **Enable voice answers** button as the quiz, and your **Read back and confirm my answer** and **Let me say yes or no while it is still speaking** choices. Commute mode always runs hands-free; it does not change the quiz's hands-free setting. The mic indicator and screen-reader live region are the same as in the quiz.
- **Buttons:** A–D (tap an answer), Repeat, Skip / Next question, and Stop.
- **Without voice recognition** (or with voice off) it still plays: question, a pause of about 8 seconds, then the answer, and on to the next. Tap an answer or press Skip to go faster.
- **Review deck:** a correct answer moves a due card up a box; a miss sends a card back to box 1, or adds the question if it is not in the deck yet; a skip changes nothing. The run ends with a short summary of counts only (correct, missed, skipped, and deck changes).
- **Locked screen:** browsers stop the mic and speech when the screen locks or the tab is hidden, so commute mode pauses then and reads the current question again when you come back. Keep the screen on (most phones have a setting for this) and the tab in front. This is a browser limit, not something this site can work around.
- **iPhone:** the first start needs a tap; if the browser then refuses to restart the mic on its own, the page says "This browser needs a tap to start the microphone" and waits for you to press **Talk**. Hands-free commute mode on iPhone has not been tested by the author.

### Python track

A second question bank for learning Python from the code that runs this project. Choose **Python** in the **Question bank** switch at the top of the start screen; the choice is remembered in this browser.

- **What it covers:** 60 original questions (v0.1), 10 in each of six topics: collections and dataclasses, regular expressions and formatting, files/JSON/errors, functions and the command line, the validator's algorithms (TF-IDF, cosine similarity, largest-remainder allocation), and calling an API safely. Every question is about [`validation/validate.py`](validation/validate.py) or [`validation/audit.py`](validation/audit.py), and names the function it comes from.
- **Code in questions:** 37 questions show a short snippet in a code block and ask what it prints. Options and stems can contain `inline code`. Code is always shown as plain text, never as HTML.
- **Answer keys that check themselves:** every "what does this print?" question is run by the validator (see below), and the build fails unless the code prints exactly the keyed option and no other option. The other 23 questions are reviewed by hand; they have not yet had the independent audit.
- **Same app, separate data:** the sampler, scoring, report, review deck, read-aloud, voice answers, and commute mode all work as for CISSP. Sessions and the review deck are stored under their own keys (`cissp-diagnostic:python:session`, `cissp-diagnostic:python:review`), so switching tracks never touches the other track's progress. The CISSP keys are unchanged from earlier versions.
- **Differences in the report:** results are grouped by topic (T1–T6) instead of domain, there is no exam-weight score and no "think like a manager" note, and question types are knowledge and application only.
- **Read-aloud and commute mode:** code read aloud is noise, so a question with code is read as its stem plus "This question has code. Read the code and the options on screen, then answer." Commute mode uses only the questions without code.
- **If the Python bank cannot load,** the page stays on (or falls back to) CISSP and says so.

Files: `data-python/` has the same layout as `data/` (`schema.json`, `taxonomy.json`, `manifest.json`, `batches/P{n}_{k}.json`). Its schema adds two optional fields: `code` (the snippet) and `verify` (`"stdout"`: run it and compare). Its taxonomy has a `track` block with the ID prefix, labels, report path, and the audit prompt.

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
- **Accepted answers:** letters (and mis-hearings such as "bee", "dee", "see", "sea"), "alpha / bravo / charlie / delta", "option 1" to "option 4", "first" to "fourth", "number two", and so on. "B as in boy" and "D for dog" also work: the letter and the first letter of the word must agree, or if the letter was mis-heard the word's first letter (A to D) is used. Filler such as "um", "I think", and "my answer is" is ignored. The best match across the interim and alternative transcripts wins. Two different letters in one phrase ("B or C") count as unclear.

Browser support (as of v0.3; engines change, so check your own browser):

| Browser | Voice answers | Notes |
|---|---|---|
| Chrome / Edge (desktop and Android) | Yes | Speech goes to the vendor's cloud service. Sessions end on their own, so hands-free reopens the mic. |
| Safari (macOS, iOS) | Partly | Starting the mic needs a tap or key press. If hands-free cannot restart it, the page asks you to press Talk. |
| Firefox | No | No `SpeechRecognition`; the controls are hidden. Commute mode still plays without voice answers. |
| iPhone Safari | Untested by the author | Commute mode and hands-free have not been tried on an iPhone. Expect the first start to need a tap. |

Other quirks handled: a listen timeout, the `no-speech` error (counts as a miss), permission denial, a missing microphone, and network errors (each turns voice off with a plain message).

**How to extend the alias list.** All spoken forms live in `lib/voice-parse.js`:

- A new word for a letter: add it to `LETTER_ALIASES` (for example `B: [..., 'bea']`).
- A number word: `NUMBER_ALIASES` (counted alone or after "option", "number", and similar words in `CONTEXT_WORDS`).
- A sound-alike that is too risky alone (such as "for"): `CONTEXT_ONLY_ALIASES`.
- A lead-in like "as in" or "for" before a clarifying word: `SPELLING_LEAD_INS`.
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
- Charts of percent correct by domain (with interval whiskers and the target line), by difficulty, and by question type (knowledge, application, managerial best/first/most).
- A "think like a manager" note that appears only when you have at least 4 managerial and 4 technical answers and your managerial score trails the technical score by 15 points or more. It never appears otherwise.
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
python validation/validate.py --data-dir data-python   # Python track; writes validation/report-python.md
python -m unittest discover -s validation -p "test_*.py"   # tests for the code checker
```

**How question code is checked** (`validation/snippets.py`): each snippet must parse, and a lint rejects imports outside a short standard-library allowlist (`collections`, `re`, `json`, `csv`, `io`, `pathlib`, `argparse`, `dataclasses`, `math`, and a few more) and names such as `open`, `eval`, `exec`, and file-writing `Path` methods. A "what does this print?" snippet then runs in a separate Python process with no site packages, an empty temporary working folder, a minimal environment, and a 5-second timeout, twice with different hash seeds so output that depends on set order is caught. It must exit cleanly and print one line equal to the keyed option. This is a lint plus isolation, not a sandbox: the snippets are written and reviewed in this repository, and the checker should never be pointed at code nobody has read. CI runs it on Python 3.12.

Unit tests cover the voice parser (letters, homophones, aliases, filler, ambiguity), the confirmation state machine, the no-correctness-leak rule, and the controller against mocked `SpeechRecognition` and `speechSynthesis` (the mic never opens while speech plays; the mic stops on navigate, submit, and unload). The track tests check that the CISSP storage keys are unchanged, that each track's session and deck stay separate, that hostile stored values fall back to CISSP, inline-code parsing, and that the Python bank runs through the unchanged sampler and scorer. The commute-mode tests drive the loop with mocked `SpeechRecognition`, `speechSynthesis`, timers, and clock: answer, verdict, next question, the 8-second skip, repeat/next/skip/stop, play-only mode without recognition, pausing on a hidden tab, and review-deck updates. The review deck tests use an injectable clock and storage and cover the box schedule, day boundaries, daylight-saving dates, a clock moving backwards, corrupt and hostile stored data, and review-session building. They also cover sampling proportions and graceful degradation, answer remapping after shuffling, the 20-answer gate, scoring, and the Wilson interval math. They run against synthetic banks of 80, 250, and 1,000 questions, plus a 1,000-session simulation that checks per-domain draw proportions stay within ±3 points of the targets.

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

For the Python track, set `DATA_DIR = "data-python"` in the notebook (or pass `--data-dir data-python` to `audit.py`). The model then gets a Python reviewer's prompt and sees each question's code, still without the key or explanations, and flags go to `validation/flags-python.csv`.

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
lib/review-deck.js               spaced review deck: schedule, storage, review sessions (no DOM)
lib/commute.js                   commute-mode loop, built on the voice controller (no DOM)
lib/tracks.js                    CISSP and Python track settings and storage keys (no DOM)
lib/rich-text.js                 **bold** and `code` runs for question text, without HTML (no DOM)
sw.js                            offline cache
data/                            CISSP question bank (CC BY 4.0)
data-python/                     Python question bank about this repository's code (CC BY 4.0)
validation/                      validate.py, snippets.py (code checker), audit.py, Colab notebook, reports, flags
tests/                           Node unit tests
.github/workflows/ci.yml         validate, test, and deploy to GitHub Pages from main
```

## Continuous integration

Every push runs the code-checker tests, the bank validator on both banks, and the unit tests. Pushes to `main` that pass both are deployed to GitHub Pages. Workflow actions are pinned to full commit SHAs, and Python dependencies are pinned to exact versions.

## Licensing

- **Code** (everything outside `data/`) is under the [MIT License](LICENSE).
- **Question banks** (`data/` and `data-python/`) are under [Creative Commons Attribution 4.0 International](data/LICENSE). You may share and adapt the questions, including commercially, if you give appropriate credit and indicate changes. Code excerpts quoted in the Python questions come from this repository's MIT-licensed files.

The split keeps the code freely reusable while making sure anyone who reuses the questions credits their source.

## Disclaimer

Unofficial practice tool. Not affiliated with or endorsed by ISC2. CISSP is a registered mark of ISC2. The questions are original practice material and have not been reviewed by ISC2. Scores are for study planning only and are not predictive of exam results.
