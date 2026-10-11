"""Tests for the question-code checker. Run: python -m unittest discover -s validation -p "test_*.py" """
from __future__ import annotations

import unittest

import snippets


def question(code, options, answer="A", verify="stdout"):
    q = {"code": code, "options": dict(zip("ABCD", options)), "answer": answer}
    if verify:
        q["verify"] = verify
    return q


class CheckQuestionTests(unittest.TestCase):
    def test_matching_key_passes(self):
        q = question('print(1 + 1)', ["`2`", "`11`", "`1`", "`3`"])
        self.assertEqual(snippets.check_question(q), [])

    def test_wrong_key_fails(self):
        q = question('print(1 + 1)', ["`2`", "`11`", "`1`", "`3`"], answer="B")
        self.assertTrue(any("keyed option B" in m for m in snippets.check_question(q)))

    def test_distractor_matching_output_fails(self):
        q = question('print("x")', ["x", "`x`", "y", "z"])
        self.assertTrue(any("option B also matches" in m for m in snippets.check_question(q)))

    def test_disallowed_import_and_names_are_not_run(self):
        for code in ["import os\nprint(os.getcwd())", "import subprocess", "print(open('x').read())", "eval('1')",
                     "print(().__class__.__bases__)", "from pathlib import Path\nPath('x').write_text('y')"]:
            with self.subTest(code=code):
                problems = snippets.check_question(question(code, ["a", "b", "c", "d"]))
                self.assertTrue(problems)
                self.assertTrue(all("not allowed" in m for m in problems), problems)

    def test_syntax_error_fails(self):
        self.assertTrue(any("does not parse" in m for m in snippets.check_question(question("print(", ["a", "b", "c", "d"]))))

    def test_hash_order_dependence_is_caught(self):
        code = 'print(list({"alpha", "bravo", "charlie", "delta", "echo", "foxtrot"}))'
        problems = snippets.check_question(question(code, ["a", "b", "c", "d"]))
        self.assertTrue(any("different output" in m for m in problems), problems)

    def test_errors_and_multiline_output_fail(self):
        self.assertTrue(any("exited with status" in m for m in snippets.check_question(question("{}['x']", ["a", "b", "c", "d"]))))
        self.assertTrue(any("one line" in m for m in snippets.check_question(question("print(1)\nprint(2)", ["a", "b", "c", "d"]))))

    def test_code_without_verify_is_only_linted(self):
        self.assertEqual(snippets.check_question(question("print(1)", ["a", "b", "c", "d"], verify=None)), [])
        self.assertTrue(snippets.check_question(question("import os", ["a", "b", "c", "d"], verify=None)))

    def test_verify_without_code_fails(self):
        self.assertTrue(snippets.check_question({"verify": "stdout", "options": {}, "answer": "A"}))

    def test_runs_in_an_empty_folder_with_no_site_packages(self):
        proc = snippets.run("import sys\nprint('site' in sys.modules)")
        self.assertEqual(proc.stdout.strip(), "False")


if __name__ == "__main__":
    unittest.main()
