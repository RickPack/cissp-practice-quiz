#!/usr/bin/env python3
"""Validate the CISSP practice question bank.

Hard failures (exit code 1): schema errors, duplicate IDs, manifest problems,
content-rule violations, and near-duplicate stems. Everything else is reported
as a warning or as progress information in validation/report.md.

Usage:
    python validation/validate.py                     # full bank from the manifest
    python validation/validate.py --include data/batches/D1_2.json   # stage a new batch
    python validation/validate.py --strict            # warnings also fail
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
LETTERS = "ABCD"
DIFFICULTIES = ("easy", "medium", "hard")
TYPES = ("knowledge", "application", "managerial_best_first_most")
DUP_THRESHOLD = 0.85
LETTER_MIN_BANK = 200
LETTER_RANGE = (0.20, 0.30)
LENGTH_BIAS_MAX = 0.35
LENGTH_BIAS_MIN = 0.15
MAX_BATCH = 50

BANNED_OPTION = re.compile(r"\b(all|none|both|neither) of (the )?(above|these|the following)\b", re.I)
NEGATION = re.compile(r"\b(NOT|EXCEPT|LEAST)\b")
STOPWORDS = set(
    """a an and are as at be been but by can could did do does for from had has have
    if in into is it its itself may might more most must no nor not of on or other our
    out over should so such than that the their them then there these they this those
    to too under up very was we were what when where which while who whom why will with
    would you your which what following best first most""".split()
)


@dataclass
class Result:
    root: Path
    questions: list = field(default_factory=list)
    files: list = field(default_factory=list)
    bank_version: str = "?"
    failures: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    info: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.failures


def load_json(path: Path, result: Result):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        result.failures.append(f"{rel(path, result.root)}: cannot read JSON ({exc})")
        return None


def rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def load_bank(root: Path, include: list[Path] | None = None) -> tuple[Result, dict]:
    result = Result(root=root)
    data = root / "data"
    taxonomy = load_json(data / "taxonomy.json", result) or {}
    schema = load_json(data / "schema.json", result) or {}
    manifest = load_json(data / "manifest.json", result) or {}
    result.bank_version = str(manifest.get("bank_version", "?"))
    if not re.fullmatch(r"\d+\.\d+", result.bank_version):
        result.failures.append("manifest.json: bank_version must look like '0.1'")

    validator = Draft202012Validator(schema) if schema else None
    listed = []
    for entry in manifest.get("batches", []):
        path = data / entry.get("file", "")
        listed.append(path.resolve())
        qs = load_batch(path, validator, result)
        if qs is None:
            continue
        if entry.get("count") != len(qs):
            result.failures.append(
                f"manifest.json: {entry.get('file')} lists count {entry.get('count')} but file has {len(qs)}"
            )
        dom = entry.get("domain")
        if dom is not None and any(q.get("domain") != dom for q in qs if isinstance(q, dict)):
            result.failures.append(f"manifest.json: {entry.get('file')} contains questions outside domain {dom}")
    for path in include or []:
        if path.resolve() in listed:
            continue
        listed.append(path.resolve())
        load_batch(path, validator, result, staged=True)

    for path in sorted((data / "batches").glob("*.json")):
        if path.resolve() not in listed:
            result.warnings.append(f"{rel(path, root)} exists but is not listed in manifest.json")
    return result, taxonomy


def load_batch(path: Path, validator, result: Result, staged: bool = False):
    name = rel(path, result.root)
    if not path.is_file():
        result.failures.append(f"{name}: file listed in manifest does not exist")
        return None
    if not re.fullmatch(r"D[1-8]_\d+\.json", path.name):
        result.failures.append(f"{name}: batch files must be named D{{n}}_{{k}}.json")
    batch = load_json(path, result)
    if batch is None:
        return None
    if validator is not None:
        for err in sorted(validator.iter_errors(batch), key=lambda e: list(e.path)):
            loc = "/".join(str(p) for p in err.path) or "(root)"
            result.failures.append(f"{name}: schema error at {loc}: {err.message}")
    if not isinstance(batch, list):
        return None
    result.files.append({"file": name, "count": len(batch), "staged": staged})
    for q in batch:
        if isinstance(q, dict):
            q = dict(q)
            q["_file"] = name
            result.questions.append(q)
    return batch


def check_content(result: Result, taxonomy: dict) -> None:
    domains = taxonomy.get("domains", {})
    seen: dict[str, str] = {}
    for q in result.questions:
        qid, where = q.get("id", "?"), q["_file"]
        if qid in seen:
            result.failures.append(f"{where}: duplicate id {qid} (also in {seen[qid]})")
        else:
            seen[qid] = where
        dom = str(q.get("domain"))
        spec = domains.get(dom)
        if not isinstance(qid, str) or not qid.startswith(f"D{dom}-"):
            result.failures.append(f"{where}: {qid} id prefix does not match domain {dom}")
        if spec:
            if q.get("domain_name") != spec["name"]:
                result.failures.append(f"{where}: {qid} domain_name should be '{spec['name']}'")
            if q.get("subtopic") not in spec.get("subtopics", {}):
                result.failures.append(f"{where}: {qid} subtopic '{q.get('subtopic')}' is not in taxonomy.json")
        options = q.get("options") or {}
        texts = [str(options.get(L, "")).strip().lower() for L in LETTERS]
        if len(set(texts)) != len(texts):
            result.failures.append(f"{where}: {qid} has duplicate option text")
        for L in LETTERS:
            if BANNED_OPTION.search(str(options.get(L, ""))):
                result.failures.append(f"{where}: {qid} option {L} uses an all/none-of-the-above construction")
        ans = q.get("answer")
        rationales = q.get("distractor_rationales") or {}
        expected = {L for L in LETTERS if L != ans}
        if set(rationales) != expected:
            result.failures.append(
                f"{where}: {qid} distractor_rationales must cover exactly {''.join(sorted(expected))}"
            )
        stem = str(q.get("stem", ""))
        for m in NEGATION.finditer(stem):
            start, end = m.span()
            if stem[max(0, start - 2):start] != "**" or stem[end:end + 2] != "**":
                result.warnings.append(f"{where}: {qid} negation '{m.group(0)}' in stem is not emphasized as **{m.group(0)}**")


def tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1 and t not in STOPWORDS]


def tfidf(docs: list[str]) -> list[dict[str, float]]:
    """Smoothed TF-IDF with L2 normalization (same weighting as scikit-learn's default)."""
    tokenized = [Counter(tokenize(d)) for d in docs]
    n = len(docs)
    df = Counter(t for tf in tokenized for t in tf)
    idf = {t: math.log((1 + n) / (1 + c)) + 1 for t, c in df.items()}
    vectors = []
    for tf in tokenized:
        vec = {t: c * idf[t] for t, c in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        vectors.append({t: v / norm for t, v in vec.items()})
    return vectors


def similar_pairs(questions: list[dict], floor: float) -> list[tuple[float, str, str]]:
    vectors = tfidf([str(q.get("stem", "")) for q in questions])
    postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for i, vec in enumerate(vectors):
        for t, w in vec.items():
            postings[t].append((i, w))
    dots: dict[tuple[int, int], float] = defaultdict(float)
    for plist in postings.values():
        for a in range(len(plist)):
            i, wi = plist[a]
            for b in range(a + 1, len(plist)):
                j, wj = plist[b]
                dots[(i, j)] += wi * wj
    pairs = [(round(s, 4), questions[i].get("id", "?"), questions[j].get("id", "?")) for (i, j), s in dots.items() if s >= floor]
    return sorted(pairs, reverse=True)


def check_duplicates(result: Result) -> None:
    pairs = similar_pairs(result.questions, 0.5)
    result.info["top_similar"] = pairs[:10]
    for score, a, b in pairs:
        if score > DUP_THRESHOLD:
            result.failures.append(f"near-duplicate stems {a} and {b} (cosine {score:.2f} > {DUP_THRESHOLD})")


def check_distribution(result: Result, taxonomy: dict) -> None:
    qs = result.questions
    n = len(qs)
    letters = Counter(q.get("answer") for q in qs)
    result.info["letters"] = {L: letters.get(L, 0) for L in LETTERS}
    if n >= LETTER_MIN_BANK:
        lo, hi = LETTER_RANGE
        for L in LETTERS:
            share = letters.get(L, 0) / n
            if not lo <= share <= hi:
                result.warnings.append(f"answer letter {L} is {share:.1%} of the bank (expected {lo:.0%}-{hi:.0%})")

    longest = defaultdict(lambda: [0, 0, 0])  # domain -> [longest, shortest, total]
    for q in qs:
        opts = q.get("options") or {}
        ans = q.get("answer")
        if ans not in opts:
            continue
        lens = {L: len(str(opts.get(L, ""))) for L in LETTERS}
        others = [lens[L] for L in LETTERS if L != ans]
        row = longest[str(q.get("domain"))]
        row[0] += lens[ans] >= max(others)
        row[1] += lens[ans] <= min(others)
        row[2] += 1
    total = [sum(r[i] for r in longest.values()) for i in range(3)]
    result.info["length_bias"] = {"overall": total, "by_domain": dict(longest)}
    if total[2] and total[0] / total[2] > LENGTH_BIAS_MAX:
        result.warnings.append(
            f"correct answer is the longest option in {total[0] / total[2]:.1%} of questions (limit {LENGTH_BIAS_MAX:.0%})"
        )
    if total[2] >= LETTER_MIN_BANK and total[0] / total[2] < LENGTH_BIAS_MIN:
        result.warnings.append(
            f"correct answer is the longest option in only {total[0] / total[2]:.1%} of questions; "
            f"below {LENGTH_BIAS_MIN:.0%} teaches test-takers to rule out the longest option"
        )

    domains = taxonomy.get("domains", {})
    grid = {d: {"difficulty": Counter(), "type": Counter(), "subtopics": Counter()} for d in domains}
    for q in qs:
        d = str(q.get("domain"))
        if d in grid:
            grid[d]["difficulty"][q.get("difficulty")] += 1
            grid[d]["type"][q.get("type")] += 1
            grid[d]["subtopics"][q.get("subtopic")] += 1
    result.info["grid"] = grid
    managerial = sum(g["type"]["managerial_best_first_most"] for g in grid.values())
    result.info["managerial_share"] = managerial / n if n else 0.0
    if n and managerial / n < taxonomy.get("managerial_min_share", 0.35):
        result.warnings.append(
            f"managerial BEST/FIRST/MOST questions are {managerial / n:.1%} of the bank (target >= 35%)"
        )


def next_milestone(taxonomy: dict, n: int) -> tuple[str, int] | None:
    for version, size in sorted(taxonomy.get("bank_milestones", {}).items(), key=lambda kv: kv[1]):
        if size > n:
            return version, size
    return None


def allocate(total: int, weights: dict[str, float]) -> dict[str, int]:
    """Largest-remainder allocation so the parts always sum to total."""
    wsum = sum(weights.values()) or 1.0
    raw = {k: total * w / wsum for k, w in weights.items()}
    parts = {k: math.floor(v) for k, v in raw.items()}
    for k in sorted(raw, key=lambda k: (raw[k] - parts[k], -int(k) if k.isdigit() else 0), reverse=True)[: total - sum(parts.values())]:
        parts[k] += 1
    return parts


def pct(a: int, b: int) -> str:
    return f"{a / b:.0%}" if b else "-"


def render_report(result: Result, taxonomy: dict) -> str:
    qs, domains = result.questions, taxonomy.get("domains", {})
    n = len(qs)
    status = "PASS" if result.ok else "FAIL"
    out = [
        "# Question bank validation report",
        "",
        f"Bank v{result.bank_version}: {n} questions in {len(result.files)} batch files.",
        "",
        f"## Result: {status}",
        "",
        f"- Hard failures: {len(result.failures)}",
        f"- Warnings: {len(result.warnings)}",
        "",
    ]
    staged = [f["file"] for f in result.files if f["staged"]]
    if staged:
        out += ["Staged (not yet in manifest): " + ", ".join(staged), ""]
    if result.failures:
        out += ["## Hard failures", ""] + [f"- {m}" for m in result.failures[:200]] + [""]
    if result.warnings:
        out += ["## Warnings", ""] + [f"- {m}" for m in result.warnings[:200]] + [""]

    grid = result.info.get("grid", {})
    out += [
        "## Progress toward v1.0 targets",
        "",
        "Informational only; shortfalls are not failures.",
        "",
        "| Domain | Questions | Easy | Medium | Hard |",
        "|---|---|---|---|---|",
    ]
    for d, spec in domains.items():
        g = grid.get(d, {"difficulty": Counter()})
        tgt = spec["difficulty_targets"]
        count = sum(g["difficulty"].values())
        cells = [f"{g['difficulty'][k]}/{tgt[k]}" for k in DIFFICULTIES]
        out.append(f"| D{d} {spec['name']} | {count}/{spec['target']} | " + " | ".join(cells) + " |")
    total_target = sum(s["target"] for s in domains.values())
    out += [f"| **Total** | **{n}/{total_target}** | | | |", ""]

    nxt = next_milestone(taxonomy, n)
    if nxt:
        version, size = nxt
        out += [f"### Next milestone: v{version} ({size} questions)", "", "| Domain | Have | Share of milestone | Still needed |", "|---|---|---|---|"]
        shares = allocate(size, {d: spec["target"] for d, spec in domains.items()})
        for d, spec in domains.items():
            want = shares[d]
            have = sum(grid.get(d, {"difficulty": Counter()})["difficulty"].values())
            out.append(f"| D{d} | {have} | {want} | {max(0, want - have)} |")
        out.append("")

    out += ["## Question types", "", "| Domain | Knowledge | Application | Managerial | Managerial share |", "|---|---|---|---|---|"]
    for d in domains:
        t = grid.get(d, {"type": Counter()})["type"]
        tot = sum(t.values())
        out.append(
            f"| D{d} | {t['knowledge']} | {t['application']} | {t['managerial_best_first_most']} | {pct(t['managerial_best_first_most'], tot)} |"
        )
    out += [f"", f"Overall managerial share: {result.info.get('managerial_share', 0):.1%} (target at least 35%).", ""]

    letters = result.info.get("letters", {})
    gate = "checked" if n >= LETTER_MIN_BANK else f"not enforced until the bank has {LETTER_MIN_BANK} questions"
    out += ["## Answer-letter distribution", "", f"Allowed range {LETTER_RANGE[0]:.0%}-{LETTER_RANGE[1]:.0%} per letter ({gate}).", "", "| A | B | C | D |", "|---|---|---|---|"]
    out += ["| " + " | ".join(f"{letters.get(L, 0)} ({pct(letters.get(L, 0), n)})" for L in LETTERS) + " |", ""]

    lb = result.info.get("length_bias", {"overall": [0, 0, 0], "by_domain": {}})
    o = lb["overall"]
    out += [
        "## Length bias",
        "",
        f"Correct answer is the longest option (ties count) in {o[0]}/{o[2]} questions ({pct(o[0], o[2])}); warning above {LENGTH_BIAS_MAX:.0%}, and below {LENGTH_BIAS_MIN:.0%} once the bank has {LETTER_MIN_BANK} questions.",
        f"Correct answer is the shortest option in {o[1]}/{o[2]} ({pct(o[1], o[2])}).",
        "",
        "| Domain | Longest | Shortest |",
        "|---|---|---|",
    ]
    for d in domains:
        r = lb["by_domain"].get(d, [0, 0, 0])
        out.append(f"| D{d} | {r[0]}/{r[2]} ({pct(r[0], r[2])}) | {r[1]}/{r[2]} ({pct(r[1], r[2])}) |")
    out.append("")

    out += ["## Most similar stems", "", f"Pairs above {DUP_THRESHOLD} fail validation. Top pairs at or above 0.50:", ""]
    top = result.info.get("top_similar", [])
    out += [f"- {a} / {b}: {s:.2f}" for s, a, b in top] or ["- none"]
    out.append("")

    out += ["## Subtopic coverage", ""]
    for d, spec in domains.items():
        have = grid.get(d, {"subtopics": Counter()})["subtopics"]
        names = list(spec.get("subtopics", {}))
        missing = [s for s in names if not have.get(s)]
        counts = ", ".join(f"{s} {have[s]}" for s in names if have.get(s))
        out.append(f"- **D{d}** {len(names) - len(missing)}/{len(names)} covered. {counts}.")
        if missing:
            out.append(f"  - Not yet covered: {', '.join(missing)}")
    out.append("")
    return "\n".join(out)


def run_checks(root: Path = ROOT, include: list[Path] | None = None) -> tuple[Result, dict]:
    result, taxonomy = load_bank(root, include)
    check_content(result, taxonomy)
    check_duplicates(result)
    check_distribution(result, taxonomy)
    return result, taxonomy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: parent of validation/)")
    parser.add_argument("--include", type=Path, action="append", default=[], help="extra batch file not yet in the manifest")
    parser.add_argument("--report", type=Path, default=None, help="report path (default: validation/report.md)")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args(argv)

    result, taxonomy = run_checks(args.root, args.include)
    report_path = args.report or args.root / "validation" / "report.md"
    report_path.write_text(render_report(result, taxonomy), encoding="utf-8")

    n = len(result.questions)
    print(f"Bank v{result.bank_version}: {n} questions, {len(result.failures)} hard failures, {len(result.warnings)} warnings")
    for m in result.failures[:25]:
        print(f"FAIL {m}")
    for m in result.warnings[:25]:
        print(f"WARN {m}")
    print(f"Report written to {rel(report_path, args.root)}")
    if result.failures or (args.strict and result.warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
