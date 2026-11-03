# Missing Go cache archive fixture

Real `//:spec-tests` graph results and compiler output captured on 2026-11-02.
Only this target was selected; its key, status and duration are unchanged.
Runs are named `run-01` and `run-02`; the home path is scrubbed to `/cache/ci/`.
Output lines are otherwise unchanged.

The first run failed while importing compiled Go cache archives, before tests
ran. The second passed with the same key. The log establishes that archives
were missing; it does not establish which cleanup or transport removed them.
