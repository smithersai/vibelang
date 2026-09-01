# `coverage-codes` fixture

Input to `node scripts/coverage-codes.mjs selftest`, which
`scripts/coverage-codes.test.mjs` runs under `node scripts/node-test-gate.mjs`.

Every file here is a **specimen of a mention shape that once fooled
`conformance/COVERAGE.md`'s code census**, sitting next to a real report site of
the same kind. The census must count the report sites and none of the mentions.
Codes are in the `SMITHERS9xxx` range, which no implementation uses, so a
fixture leaking into a real derivation would be obvious rather than plausible.

- `SMITHERS90xx` — REPORT sites. Each must be counted.
- `SMITHERS91xx` — MENTIONS only. Each must be rejected.

The mapping from each specimen back to the real miscount it stands for is in
`scripts/coverage-codes.mjs` (`FIXTURE_MENTIONED_ONLY`) and in the comment above
each specimen below.

**This file is one of the specimens.** `SMITHERS9104` appears in the sentence you
are reading, exactly as `SMITHERS1708` appeared in `compiler/FORK-SEAM-DESIGN.md`
saying the fork retires it. A census that reads markdown counts it — and to make
that independently load-bearing rather than incidental, the next line is prose in
full report shape, which the "must be a quoted string" half of the rule would
otherwise let through:

    the rule this replaced used to read report(node, "SMITHERS9104", "gone")

Why a fixture rather than an assertion over the real tree: an assertion over the
real tree changes meaning every time the tree does, so it cannot separate "the
extractor regressed" from "someone deleted a rule". This directory does not move.
