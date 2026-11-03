"""Merge queue retirement check. Install beside retirement-gate.mjs and diagnostic-identity.mjs.
Call before queue admission (precheck=True) and after building the prepared tip (precheck=False).
Any unavailable check is a refusal. No known-red or spec-judge bypass applies.
"""
import os
import subprocess


def retirement_check(base, head, root, precheck=False, run=subprocess.run):
    script = os.path.join(os.path.dirname(__file__), "retirement-gate.mjs")
    command = ["node", script, "--root", root, "--base", base, "--head", head]
    if precheck:
        command.append("--precheck")
    try:
        result = run(command, cwd=root, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as error:
        return True, "retirement-needs-fix unavailable: " + type(error).__name__
    if result.returncode:
        return True, "retirement-needs-fix: " + (result.stderr or result.stdout or "check failed").strip()[-1600:]
    return False, ""
