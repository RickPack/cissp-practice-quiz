# Question bank validation report

Bank v0.1: 60 questions in 6 batch files.

## Result: PASS

- Hard failures: 0
- Warnings: 0

## Progress toward v1.0 targets

Informational only; shortfalls are not failures.

| Topic | Questions | Easy | Medium | Hard |
|---|---|---|---|---|
| T1 Collections and dataclasses | 10/10 | 3/3 | 5/5 | 2/2 |
| T2 Regular expressions and formatting | 10/10 | 3/3 | 4/4 | 3/3 |
| T3 Files, JSON, and errors | 10/10 | 3/3 | 5/5 | 2/2 |
| T4 Functions and the command line | 10/10 | 3/3 | 4/4 | 3/3 |
| T5 Algorithms in the validator | 10/10 | 3/3 | 5/5 | 2/2 |
| T6 Calling an API safely | 10/10 | 3/3 | 4/4 | 3/3 |
| **Total** | **60/60** | | | |

## Question types

| Topic | Knowledge | Application |
|---|---|---|
| T1 | 3 | 7 |
| T2 | 2 | 8 |
| T3 | 3 | 7 |
| T4 | 5 | 5 |
| T5 | 5 | 5 |
| T6 | 5 | 5 |

## Answer-letter distribution

Allowed range 20%-30% per letter (not enforced until the bank has 200 questions).

| A | B | C | D |
|---|---|---|---|
| 15 (25%) | 15 (25%) | 15 (25%) | 15 (25%) |

## Length bias

Correct answer is the longest option (ties count) in 11/60 questions (18%); warning above 35%, and below 15% once the bank has 200 questions.
Correct answer is the shortest option in 26/60 (43%).

| Topic | Longest | Shortest |
|---|---|---|
| T1 | 1/10 (10%) | 8/10 (80%) |
| T2 | 2/10 (20%) | 2/10 (20%) |
| T3 | 1/10 (10%) | 1/10 (10%) |
| T4 | 4/10 (40%) | 5/10 (50%) |
| T5 | 2/10 (20%) | 5/10 (50%) |
| T6 | 1/10 (10%) | 5/10 (50%) |

## Question code

37 questions include code; every snippet parses and passes the lint.
37 "what does this print?" questions were run, and each printed exactly its keyed option.

## Most similar stems

Pairs above 0.85 fail validation. Top pairs at or above 0.50:

- P1-0003 / P1-0004: 0.77
- P1-0001 / P1-0002: 0.65
- P4-0001 / P4-0010: 0.64
- P1-0005 / P1-0006: 0.64
- P1-0006 / P1-0007: 0.59
- P1-0005 / P1-0007: 0.57
- P6-0001 / P6-0002: 0.54

## Subtopic coverage

- **T1** 4/4 covered. Counter 3, defaultdict 2, Dataclasses 3, Comprehensions 2.
- **T2** 3/3 covered. Regex patterns 6, Regex flags and matches 2, String formatting 2.
- **T3** 4/4 covered. Paths 2, JSON 2, Exceptions 3, CSV 3.
- **T4** 4/4 covered. Type hints 2, argparse 2, Script structure 4, Sorting and keys 2.
- **T5** 3/3 covered. TF-IDF 4, Cosine similarity 3, Largest-remainder allocation 3.
- **T6** 4/4 covered. Secrets and configuration 2, Errors and retries 3, Batch processing 2, Model output 3.
