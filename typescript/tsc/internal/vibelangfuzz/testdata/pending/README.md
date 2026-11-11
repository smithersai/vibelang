# Pending gaps

Each `.txt` file here lists gaps between the specification and the compiler
that one area of fuzz targets found, one per line:

```text
<target> <key> <owner> <what is missing, with the decision it breaks>
```

`key` names what disagrees: the oracle's own key (such as `feature:<oracle>`,
`ek:<EK code>` or `crash:<function>`), or `corpus:<file>` for a minimal
reproduction in `testdata/fuzz/<target>/`. `owner` is `compiler` or
`projector` for a gap in the product, or the area whose test does not reach
that part of the specification yet. See `pending.go`.

- An oracle's key skips the disagreement it names. A corpus line never skips
  anything by itself: it marks its reproduction, and the reproduction fails as
  XPASS once it meets every oracle. Delete both lines in the change that fixes
  the gap.
- A key names what differs, never a whole oracle: a line under an oracle's
  only key would skip every failure of that oracle. `FuzzDeclarationIdentity`
  keys each difference by its kind and export, such as
  `feature:declaration-identity:type:<export>`, and the declaration consumer
  keys each error by its TypeScript code and the declaration it is in, such as
  `feature:declaration-consumer-TS2693:<declaration>`. `TestPendingLines`
  rejects the bare `feature:declaration-identity`.
- A line must stay reachable. The package records each line an oracle raises
  or deliberately omits. A gate run (`VIBELANG_FUZZ_REQUIRE=1`) of a whole
  target, together with the tests that `PendingCompanion` registers as
  raising keys under its name, fails with `XPASS` for each of the target's
  lines that nothing used: no seed raises the key any more, or the key is
  misspelt. Delete the line, or add the corpus input that raises it, so a
  `-short` run reaches it. Where a key names one probe, the probe also calls
  `ExpectPending` when it holds, and fails at once.
  A complete matrix test that skips under `-short` calls `SkipShortMatrix`,
  which leaves its target unjudged in that run. Register the matrix with
  `PendingCompanion` when some keys are raised only there:
  `pending.sh` sets `VIBELANG_FUZZ_MATRIX=1` and runs it whole. A run whose
  tests fail prints a note that the audit did not run.
- A tools target skips an input it leaves out for a pending generator
  feature, and the skip names every matching feature. The `layer-declaration` feature
  matches a `layer` declaration by its tokens, never the word in a comment or
  a string.
- A line owned by `compiler` names the chapter or decision it breaks, or the
  key whose line does. A crash or a hang needs no citation.
- A hang's reproduction (a reason that starts with `hang`) is skipped by its
  target. `TestPendingHangs` runs it in a child process with a deadline and
  fails as XPASS when it finishes. The merge gate requires this check through
  the separately cached `//:go-vibelangfuzz-hangs` target; selecting only the
  named corpus would skip the hang.
- A VIP can replace the rule an oracle checks. Then the owner is
  `superseded` and the reason starts with that VIP:

  ```text
  FuzzConfig  ek:EK4834  superseded  VIP-6: effectGlobals turns the Effect globals off
  ```

  The oracle skips for good and never fails as XPASS. A superseded key, and
  only a superseded key, may end in `*` to cover every key with that prefix,
  such as `ek:EK48*`. The VIP must be accepted in `docs/design/vips/`. Retiring
  an oracle whose rule a VIP replaced is not weakening it; rewrite or delete
  the oracle once its new rule is in the specification, and delete the line.
- `TestPendingLines` checks all of this. An `ek:EKxxxx` key is dead when the current specification no longer registers that code.
- A `registry:EKxxxx` key records a compiler-emitted code absent from the current specification. Its minimized corpus input and `corpus:<file>` marker record the gap until the code is specified. `TestCompilerRegistryIsSpecified` requires every implementation declaration to have a current assignment; there are no declaration-only allowances. Graduated `registry-EK*` corpus files remain regression inputs for `FuzzCompile`.

A corpus line names its reproduction by file name, so the file's input must
keep its meaning. `FuzzVIPDifferential`'s first input byte indexes the
constructs not left out, which shifts whenever a construct is registered or a
pending line is deleted; write its reproductions in the named form instead,
`[]byte("key:<construct key>\x00<rest>")`, which `vipgen.Seed` produces and
which focuses that construct whatever else is registered. A named
reproduction of a pending construct generates nothing and skips until the
construct's `feature:` line is deleted. Old index inputs still decode.

A `feature:` line whose reason starts with `hang` also needs a same-target
`corpus:` line whose reason starts with `hang` and names that feature key.
`TestPendingLines` enforces this link. `TestPendingHangs` bypasses feature
exclusions and runs each witness under a deadline: a reproduction that
completes fails as `XPASS`, so a fixed hang cannot remain hidden by an
exclusion that merely records its own use. Remove both lines when it completes.
