#!/usr/bin/env python3
"""Independent answer-key audit.

A Claude model answers each question WITHOUT seeing the key, explanation, or
rationales. Disagreements, low-confidence answers, and questions where the model
thinks another option is also defensible are written to validation/flags.csv for
human review.

Used by validate_bank.ipynb in Colab. It can also run locally:
    ANTHROPIC_API_KEY=... python validation/audit.py --target data/batches/D1_2.json
Never commit an API key; in Colab the key comes from Colab Secrets.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_THRESHOLD = 70
LETTERS = "ABCD"

SYSTEM_PROMPT = (
    "You are an experienced information security professional taking a CISSP-style "
    "practice exam. Choose the single BEST answer from the perspective of a security "
    "manager advising the business: prioritize life safety, then governance and risk-based "
    "decisions, then technical fixes. Then critique the item as a reviewer: list any other "
    "option you consider equally defensible, and note any flaw such as an ambiguous stem, "
    "a factual error, or a clue that gives the answer away."
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "enum": list(LETTERS)},
        "confidence": {"type": "integer", "description": "0-100: how sure you are the chosen answer is the single best one"},
        "rationale": {"type": "string", "description": "Two or three sentences explaining the choice"},
        "other_defensible": {
            "type": "array",
            "items": {"type": "string", "enum": list(LETTERS)},
            "description": "Other options a well-prepared candidate could reasonably defend; empty if none",
        },
        "item_issue": {"type": "string", "description": "Any flaw in the question itself; empty string if none"},
    },
    "required": ["answer", "confidence", "rationale", "other_defensible", "item_issue"],
    "additionalProperties": False,
}

FLAG_FIELDS = [
    "id", "file", "domain", "subtopic", "difficulty", "type", "key", "model_answer",
    "confidence", "other_defensible", "reasons", "model_rationale", "item_issue",
    "model", "audited_at", "resolution",
]


def load_questions(root: Path, target: str = "all") -> list[dict]:
    """target is 'all' (every manifest batch) or a path to one batch file."""
    data = root / "data"
    if target == "all":
        manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
        files = [data / b["file"] for b in manifest["batches"]]
    else:
        path = Path(target)
        files = [path if path.is_absolute() else root / path]
    questions = []
    for path in files:
        for q in json.loads(path.read_text(encoding="utf-8")):
            q = dict(q)
            q["_file"] = path.name
            questions.append(q)
    return questions


def question_prompt(q: dict) -> str:
    """Only the stem and options: the key, explanation, and rationales stay hidden."""
    lines = [f"Domain: {q['domain_name']}", "", q["stem"], ""]
    lines += [f"{L}. {q['options'][L]}" for L in LETTERS]
    return "\n".join(lines)


def request_params(q: dict, model: str, effort: str) -> dict:
    return {
        "model": model,
        "max_tokens": 16000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": question_prompt(q)}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
    }


def parse_message(message) -> dict:
    if getattr(message, "stop_reason", None) == "refusal":
        return {"error": "model declined to answer"}
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        out = json.loads(text)
    except json.JSONDecodeError:
        return {"error": f"unparseable response: {text[:200]}"}
    out["confidence"] = max(0, min(100, int(out.get("confidence", 0))))
    return out


def audit_sync(client, questions: list[dict], model: str, effort: str, cache: Path | None = None, progress=print) -> dict:
    """One request per question. Results are cached so an interrupted run resumes."""
    import anthropic

    results = json.loads(cache.read_text(encoding="utf-8")) if cache and cache.exists() else {}
    todo = [q for q in questions if q["id"] not in results or "error" in results[q["id"]]]
    for i, q in enumerate(todo, 1):
        try:
            results[q["id"]] = parse_message(client.messages.create(**request_params(q, model, effort)))
        except anthropic.RateLimitError as exc:
            wait = int(exc.response.headers.get("retry-after", "30"))
            progress(f"rate limited; sleeping {wait}s")
            time.sleep(wait)
            results[q["id"]] = {"error": "rate limited; rerun to retry"}
        except anthropic.APIStatusError as exc:
            results[q["id"]] = {"error": f"API error {exc.status_code}: {exc.message}"}
        except anthropic.APIConnectionError:
            results[q["id"]] = {"error": "connection error; rerun to retry"}
        if cache:
            cache.write_text(json.dumps(results, indent=1), encoding="utf-8")
        if i % 10 == 0 or i == len(todo):
            progress(f"{i}/{len(todo)} audited")
    return results


def audit_batch(client, questions: list[dict], model: str, effort: str, poll_seconds: int = 60, progress=print) -> dict:
    """Message Batches API: half the cost, usually done within an hour."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    batch = client.messages.batches.create(
        requests=[
            Request(custom_id=q["id"], params=MessageCreateParamsNonStreaming(**request_params(q, model, effort)))
            for q in questions
        ]
    )
    progress(f"batch {batch.id} submitted with {len(questions)} requests")
    while batch.processing_status != "ended":
        time.sleep(poll_seconds)
        batch = client.messages.batches.retrieve(batch.id)
        progress(f"status {batch.processing_status}: {batch.request_counts.succeeded} succeeded, {batch.request_counts.processing} processing")
    results = {}
    for item in client.messages.batches.results(batch.id):
        if item.result.type == "succeeded":
            results[item.custom_id] = parse_message(item.result.message)
        else:
            results[item.custom_id] = {"error": f"batch request {item.result.type}"}
    return results


def make_flags(questions: list[dict], results: dict, model: str, threshold: int = DEFAULT_THRESHOLD) -> list[dict]:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    flags = []
    for q in questions:
        r = results.get(q["id"], {"error": "not audited"})
        reasons = []
        if "error" in r:
            reasons.append(r["error"])
        else:
            if r["answer"] != q["answer"]:
                reasons.append("disagrees with key")
            if r["confidence"] < threshold:
                reasons.append(f"confidence below {threshold}")
            others = [L for L in r.get("other_defensible", []) if L != r["answer"]]
            if others:
                reasons.append("another option also defensible")
            if r.get("item_issue", "").strip():
                reasons.append("item issue noted")
        if reasons:
            flags.append({
                "id": q["id"], "file": q["_file"], "domain": q["domain"], "subtopic": q["subtopic"],
                "difficulty": q["difficulty"], "type": q["type"], "key": q["answer"],
                "model_answer": r.get("answer", ""), "confidence": r.get("confidence", ""),
                "other_defensible": "".join(r.get("other_defensible", [])), "reasons": "; ".join(reasons),
                "model_rationale": r.get("rationale", ""), "item_issue": r.get("item_issue", ""),
                "model": model, "audited_at": stamp, "resolution": "",
            })
    return flags


def summarize(questions: list[dict], results: dict, flags: list[dict]) -> str:
    answered = [q for q in questions if "error" not in results.get(q["id"], {"error": 1})]
    agree = sum(results[q["id"]]["answer"] == q["answer"] for q in answered)
    return (
        f"Audited {len(answered)}/{len(questions)} questions. "
        f"Model agreed with the key on {agree}/{len(answered) or 1} ({agree / (len(answered) or 1):.0%}). "
        f"{len(flags)} flagged for review."
    )


def write_flags(flags: list[dict], path: Path, audited_ids: set[str]) -> None:
    """Rows for questions audited in this run are replaced; rows for other questions are kept."""
    existing = {}
    if path.exists():
        with path.open(encoding="utf-8", newline="") as fh:
            existing = {row["id"]: row for row in csv.DictReader(fh) if row["id"] not in audited_ids}
    for f in flags:
        existing[f["id"]] = f
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FLAG_FIELDS)
        writer.writeheader()
        for qid in sorted(existing):
            writer.writerow({k: existing[qid].get(k, "") for k in FLAG_FIELDS})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", default="all", help="'all' or a batch file path")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--effort", default="high", choices=["low", "medium", "high", "max"])
    parser.add_argument("--mode", default="sync", choices=["sync", "batch"])
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    parser.add_argument("--limit", type=int, default=0, help="audit only the first N questions (smoke test)")
    args = parser.parse_args(argv)

    import anthropic

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY in the environment (never in a file in this repo).", file=sys.stderr)
        return 2
    client = anthropic.Anthropic()
    questions = load_questions(ROOT, args.target)
    if args.limit:
        questions = questions[: args.limit]
    if args.mode == "batch":
        results = audit_batch(client, questions, args.model, args.effort)
    else:
        results = audit_sync(client, questions, args.model, args.effort, cache=ROOT / "validation" / ".audit_cache.json")
    flags = make_flags(questions, results, args.model, args.threshold)
    write_flags(flags, ROOT / "validation" / "flags.csv", {q["id"] for q in questions})
    print(summarize(questions, results, flags))
    return 0


if __name__ == "__main__":
    sys.exit(main())
