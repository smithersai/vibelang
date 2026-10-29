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
- A line owned by `compiler` names the chapter or decision it breaks, or the
  key whose line does. A crash or a hang needs no citation.
- A hang's reproduction (a reason that starts with `hang`) is skipped by its
  target. `TestPendingHangs` runs it in a child process with a deadline and
  fails as XPASS when it finishes.
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
- `TestPendingLines` checks all of this.

A corpus line names its reproduction by file name, so the file's input must
keep its meaning. `FuzzVIPDifferential`'s first input byte indexes the
constructs not left out, which shifts whenever a construct is registered or a
pending line is deleted; write its reproductions in the named form instead,
`[]byte("key:<construct key>\x00<rest>")`, which `vipgen.Seed` produces and
which focuses that construct whatever else is registered. A named
reproduction of a pending construct generates nothing and skips until the
construct's `feature:` line is deleted. Old index inputs still decode.
