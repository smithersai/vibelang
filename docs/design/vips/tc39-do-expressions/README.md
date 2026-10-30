# TC39 do expressions: the pinned snapshot

VIP-2 makes VibeLang's `do { … }` exactly the TC39 do-expressions proposal, pinned to this snapshot (decided detail 52, 2026-10-29). VibeLang moves to a newer snapshot deliberately, by replacing these files in a commit that says what changed, never automatically.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/tc39/proposal-do-expressions` |
| Commit | `3ef6d463b8163cbf222846b40d17178cca36e9e1` ("fix bug with isLast"), the head of the default branch on 2026-10-28 (UTC) |
| Commit date | 2021-03-03 |
| Fetched | 2026-10-29 |
| Stage | 1 |
| License | MIT, in [`LICENSE`](LICENSE) |

| File | Upstream file |
| --- | --- |
| [`explainer.md`](explainer.md) | `README.md`, the explainer |
| [`spec.emu`](spec.emu) | `spec.emu`, the draft specification text |

VibeLang retains the proposal's completion behavior, with the reconciliations below. A `do` gives an expression completions no other expression has: `return`, `break` and `continue`. ECMA-262 says "abrupt" in steps written when an expression could only throw, and the proposal never reconciled them. VibeLang keeps the jump a jump. The draft text stays as vendored.

| Step | ECMA-262 | VibeLang |
| --- | --- | --- |
| `EvaluateAsyncFunctionBody`, `EvaluateAsyncConciseBody` | "If completion is an abrupt completion, then Perform ! Call(promiseCapability.[[Reject]], undefined, « completion.[[Value]] »)." | a `return v` in a parameter default fulfills with `v`, as `return v` at the top of the body does; a throw rejects |
| `EvaluateGeneratorBody`, `EvaluateAsyncGeneratorBody` | "Perform ? FunctionDeclarationInstantiation(funcObj, argList)." lets the completion leave before the generator exists | a `return v` in a parameter default gives a generator that finishes with `v`, as `return v` at the top of the body does, and the body never starts |

`FinishMatch` has the same mistake, in the pattern-matching draft ([its reconciliations](../tc39-pattern-matching/README.md)). An `effect` function, which ECMA-262 doesn't have, follows the `async` row: the call gives an Effect that succeeds with `v`.

## Static-predicate reconciliations

For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged.

The upstream `spec.emu` stays unchanged. These are the missing empty case-block base case and the native iteration classification for the added loops, not a blanket fallback for unrecognized syntax. [Appendix A](../../src/900-appendices.md#notes-on-the-productions) records the effective rules; [Running Effects](../../src/002-running.md#do-expressions) gives checked examples.
