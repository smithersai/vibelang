# VibeLang prototype — NOTES

Quickest-possible working prototype. Speed was the goal; this is a demo-grade
lowering pipeline, not a compiler. Run it with `./run.sh` (or `bun run demo`).

This is a historical syntax experiment, not the current design. In particular,
the accepted language now uses named `uses name: Type` parameters and
Effect-like layers from `vibelang:provider`; the prototype's special
`provide { ... }` block remains only because that is what the regex demo
implemented.

## What it does (all verified working end-to-end)

- `error Name { field: type }` → class extending `__VSError` (which extends `Error`)
  with `_tag`, declared fields, a fields-object constructor, and the
  `Symbol.for("vibelang.failure")` brand.
- `try expr` in expression position → `__vsTry(() => (expr))` (pass-through; JS
  throw already propagates — the pass just makes the syntax legal).
- `expr catch |e| fallback` → `__vsCatch(() => expr, (e) => fallback)`. Branded
  failures are handled; defects rethrow. `switch (e._tag) { case "T": expr }`
  fallbacks are supported by wrapping the switch in the handler body, rewriting
  inline case bodies to `return (expr);`, and appending `throw e;` so unmatched
  tags rethrow.
- `uses A, B` on function declarations → `const A = __vsUse("A"); ...` injected at
  body top. `provide { A: a } { body }` → `__vsProvide(frame, () => { body })`
  over a module-global stack of frames (push / finally-pop). Missing capability
  throws an unbranded `Error` = defect.
- Stretch goal landed: single-line if-expressions after `=`/`return` → ternary.
- `!NotFound`-style error-channel return annotations are simply stripped
  (type-level channels out of scope, per the brief).

## Shortcuts / hacks taken (deliberately)

1. **No parser.** `vsc.ts` is ~6 ordered regex passes over the raw source plus a
   tiny brace/paren matcher (`matchDelim`) and two expression-boundary
   heuristics (`scanExprBack` / `scanExprFwd`). Expression boundaries are guessed
   by walking until an unbalanced delimiter or a `= , ; { }` / newline at depth 0.
   Works for the demo; will mis-slice on gnarlier code (e.g. `return x catch |e| y`
   swallows the `return`, multi-line expressions, `=` inside default params).
2. **String/comment awareness is partial.** `matchDelim` and `scanExprFwd` skip
   strings and `//` comments; `scanExprBack` does not. Block comments (`/* */`)
   are invisible to everything. Template literals are skipped naively (no nested
   `${}` handling) — a `{`-imbalanced string would derail brace matching.
3. **Errors extend a runtime base class** (`__VSError`) rather than `Error`
   directly — that's where `_tag`, the message, and the symbol brand get set,
   because a computed `[Symbol.for(...)]` class field is fussier in TS than one
   `(this as any)[FAILURE] = true` in a base constructor. Fields land via
   `Object.assign`; the generated subclass uses `declare readonly` so nothing
   clobbers them. Spec-compliant in spirit ("class extending Error"), one hop
   removed in letter.
4. **`uses` only works on `function` declarations** (not arrows/methods), and the
   capability lookup happens eagerly at call time for all listed capabilities,
   not lazily per reference. A return type containing `{` would break the
   signature scan (it looks for the first `{` after the param list).
5. **switch-fallback case bodies must be single-line expressions** (they get
   `return (...)`-wrapped by a line regex). Real block bodies or multi-line
   expressions in a case would produce garbage. No `default:` needed — the
   appended `throw e` handles unmatched tags.
6. **if-expressions are single-line only** and the condition can't contain `)`
   (plain `[^)]*` regex). Nested if-else-if chains untested, probably broken.
7. **provide's frame object must come right before the block**, both brace-matched;
   `provide` used in expression position happens to work (it lowers to a call
   that returns the body's value) but is untested.
8. **Context is a plain global stack** — synchronous only. `await` inside a
   `provide` block or calling a `uses` function from a later async tick would
   read the wrong (or no) frame. Real impl would use `AsyncLocalStorage`.
9. **Fake typing.** Handler params are emitted as `(e: any)`; `__vsUse` returns
   `any`. The output typechecks (verified with tsc 7 preview, `--noEmit`, clean)
   mostly because everything interesting is `any`.
10. **tsc is a local devDependency** (`typescript@7.0.2`, the Go-based preview —
    it's what bun resolved). Node 22.4 here can't strip types, so **bun** runs
    both the transpiler and the lowered output; the run script degrades
    gracefully (skips typecheck) if `node_modules` is absent.

## What broke along the way

Honestly: nothing at runtime — the pipeline ran clean on the first execution.
The traps were dodged at design time instead: the word "try" appearing inside
comments would have triggered the try-expression pass (hence the
`inLineComment` guard), object-literal case bodies starting with `{` would have
parsed as blocks (hence unconditional `return (...)` wrapping), and template
literals containing `${id}` would have confused a brace counter that didn't
skip strings.

## What I'd do next

- Replace the regex passes with a real tokenizer + Pratt parser over a tolerant
  TS grammar (or fork a lexer and do token-stream rewriting), so expression
  boundaries stop being heuristic.
- Type-level error channels: emit `Result`-style declarations or a
  `ts-plugin`/codegen that surfaces `!NotFound` in signatures instead of
  stripping it; check `catch |e|` exhaustiveness against the inferred failure set.
- `AsyncLocalStorage`-backed context; `uses` on arrows/methods; lazy per-reference
  capability resolution (`__ctx().Db`) so unused capabilities don't throw.
- Source maps, a file watcher, and a bun plugin (`Bun.plugin` onLoad for `.vibe`)
  so `.vibe` files import directly without a separate transpile step.
