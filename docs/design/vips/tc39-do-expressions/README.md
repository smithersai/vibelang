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

## What VibeLang takes from it

- The block runs where the do expression stands. `return`, `break`, `continue`, `var`, `await` and `yield` inside it mean what they mean around it, and so does `try` in effect code.
- The value is the block's completion value, `undefined` for an empty block.
- The early errors: the block cannot end in a declaration, a loop or an `if` without `else` (`EndsInIterationOrBareIfOrDeclaration`, `EK0201`); an unlabeled `break` or `continue` cannot leave a do expression in a loop's head, nor can a jump target that loop (`EK0205`); a do expression in a parameter list cannot declare `var` (`EK0203`). A statement cannot start with `do {`, which is the `do`-`while` statement.

VibeLang retains the proposal's completion behavior, with the reconciliations below. A `do` gives an expression completions no other expression has: `return`, `break` and `continue`. ECMA-262 says "abrupt" in steps written when an expression could only throw, and the proposal never reconciled them. VibeLang keeps the jump a jump. The draft text stays as vendored.

| Step | ECMA-262 | VibeLang |
| --- | --- | --- |
| `EvaluateAsyncFunctionBody`, `EvaluateAsyncConciseBody` | "If completion is an abrupt completion, then Perform ! Call(promiseCapability.[[Reject]], undefined, « completion.[[Value]] »)." | a `return v` in a parameter default fulfills with `v`, as `return v` at the top of the body does; a throw rejects |
| `EvaluateGeneratorBody`, `EvaluateAsyncGeneratorBody` | "Perform ? FunctionDeclarationInstantiation(funcObj, argList)." lets the completion leave before the generator exists | a `return v` in a parameter default gives a generator that finishes with `v`, as `return v` at the top of the body does, and the body never starts |

`FinishMatch` has the same mistake, in the pattern-matching draft ([its reconciliations](../tc39-pattern-matching/README.md)). An `effect` function, which ECMA-262 doesn't have, follows the `async` row: the call gives an Effect that succeeds with `v`.

## Static-predicate reconciliations

For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged.

The upstream `spec.emu` stays unchanged. These are the missing empty case-block base case and the native iteration classification for the added loops, not a blanket fallback for unrecognized syntax. [Appendix A](../../src/900-appendices.md#notes-on-the-productions) records the effective rules; [Running Effects](../../src/002-running.md#do-expressions) gives checked examples.

## Variable statements at the end

For `Statement : VariableStatement`, the pinned predicate returns `isLast`. A final `var` declaration is therefore `EK0201`, including when only empty statements or empty blocks follow it. A nonfinal `var` remains legal and hoists to the enclosing function: `do { var value = 1; value }` keeps that behavior. The separate parameter-list restriction remains `EK0203`. This follows the existing vendored `Statement : VariableStatement` algorithm; it does not change the pinned snapshot.

## Where the compiler falls short of it

The compiler lowers a do expression to the statements around it. Where no statement surrounds it, as in a parameter default, a declaration in a for-loop initializer, a class member, a `case` test, an optional chain, or a VibeLang form the compiler still writes as a function (`catch` and `throw` expressions, `fork`), it keeps a function. There the current compiler reports `EK0204` for a `return`, `var`, a jump out, `await` or `yield` inside the block. That is a compiler gap, not a language rule: VibeLang means what the snapshot says, so `function f(x = do { return null }) {}` returns `null` from `f`, as the table above and VIP-2's 2026-10-30 amendments require ([Running Effects](../../src/002-running.md#parameter-defaults)).
