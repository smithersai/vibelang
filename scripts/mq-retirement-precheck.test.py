import importlib.util
import subprocess
import unittest
import re
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("retirement", Path(__file__).with_name("mq-retirement-precheck.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class RetirementAdmission(unittest.TestCase):
    def test_validation_steps_match_the_queue_failure_summary_grammar(self):
        grammar = r"^[a-z+/:]+(?: [a-z+/:]+)? [1-9][0-9]*(\s|$)"
        patch = Path(__file__).with_name("mq-retirement-integration.patch").read_text()
        for step in ["retirement precheck", "retirement final"]:
            self.assertRegex(step + " 1", grammar)
            self.assertIn('echo "' + step + ' $', patch)
        self.assertNotRegex("retirement precheck 0", grammar)

    def test_final_check_always_executes_witnesses(self):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        self.assertEqual(adapter.retirement_check("base", "head", ".", run=run), (False, ""))
        self.assertNotIn("--precheck", calls[0][0])
        self.assertEqual(calls[0][1]["timeout"], 300)

    def test_precheck_only_for_early_admission(self):
        def run(args, **kwargs):
            self.assertIn("--precheck", args)
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        self.assertFalse(adapter.retirement_check("base", "head", ".", precheck=True, run=run)[0])

    def test_missing_checker_timeout_and_every_nonzero_status_refuse(self):
        for status in [1, 2, 127, -9]:
            run = lambda *a, **kw: SimpleNamespace(returncode=status, stdout="", stderr="EK1010 missing fix")
            bad, reason = adapter.retirement_check("base", "head", ".", run=run)
            self.assertTrue(bad)
            self.assertIn("EK1010", reason)
        for error in [FileNotFoundError(), subprocess.TimeoutExpired("node", 300)]:
            def run(*a, **kw):
                raise error
            self.assertTrue(adapter.retirement_check("base", "head", ".", run=run)[0])


if __name__ == "__main__":
    unittest.main()
