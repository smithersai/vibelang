# VIP-2: `effect { }` blocks, and `do { }` as TC39 defines it

**Status:** accepted by Will, 2026-10-28.

## Decision

- **Amended 2026-10-30: call references.** Expressions retain ECMAScript's native call-reference and argument evaluation behavior, including receiver binding and non-callable errors. Compiler invocation machinery introduces no observable helper lookup; see [Evaluation order](../src/002-running.md#evaluation-order).

```ts
const p = effect { console.log("hi"); return 1 }   // an Effect, not yet run
try p                                              // prints "hi", gives 1
try p                                              // prints "hi" again: each run reruns the block

try retry(effect { try save(try fetchUser(id)) }, policy)
Layer.effect(Users, effect { … })

const x = do { const a = 1; a + 1 }                // TC39 do expression: runs now, x = 2
```

- `effect { … }` is an expression. It builds an Effect from the block without running it, and each time the Effect runs, the block runs again.
  - It is Effect TS's `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.
  - Inside it, `try` runs Effects, as in an `effect` function (VIP-5).
- `effect` before a function makes a function that returns an Effect (VIP-1). `effect` before a block makes the Effect itself.
- `do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal (moved deliberately, as VIP-7 does for `match`), everywhere, with no exceptions. It runs now and gives its last statement's value, like an IIFE. As TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`.
- No other syntax builds a program. A function literal never turns into a program because the parameter it's passed to expects an Effect.
- **Amended 2026-10-29: `do` follows TC39 exactly.** VibeLang adds no limits on `var`, `break` or `continue` inside a `do` block (the old EK1019 is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: the pinned snapshot.** `do` is pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1`, the head on 2026-10-28 (UTC), vendored in [`tc39-do-expressions/`](tc39-do-expressions/README.md), as pattern matching is pinned. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 52).
- **Amended 2026-10-30: complete the pinned static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged. The [snapshot receipt](tc39-do-expressions/README.md#static-predicate-reconciliations) records the effective reconciliation without changing the vendored draft; [Running Effects](../src/002-running.md#do-expressions) gives the completion witnesses and their Exits.
- **Amended 2026-10-30: `return` in a `do` in a parameter default.** A parameter list whose `do` contains a `return` lowers by moving every default from that parameter on into the body, so the `return` returns from the function; `length` is unchanged. The one divergence from TC39 is a default that reads a later parameter in its TDZ. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 68).
- **Amended 2026-10-30: defaults that suspend or jump stay in the enclosing activation.** A parameter or destructuring default containing `try`, `await`, `yield`, or a `do` whose `return`, `break` or `continue` leaves the default, lowers into guarded statements in the enclosing function at the default's place, never into an arrow, keeping the pattern's evaluation order and its other bindings. `effect function f() { const { x = do { return 9 } } = {}; return 0 }` succeeds with 9. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 68a).
- **Amended 2026-10-30: defaults stay native where they can; expanded ones close iterators exactly.** A destructuring default whose suspending `do` (or `try`/`await`) lowers to one expression stays native destructuring in the generator: `const [x = do { try succeed(7); bad.value }] = xs` is `const [x = (yield* Effect.succeed(7), bad.value)] = xs`, so ECMAScript's own evaluation order and IteratorClose apply. Only a default with a statement that is not an expression, or a `return`, `break` or `continue` leaving it, uses the expanded statements, which close the iterator by ECMA-262 IteratorClose: `return` is called on the iterator, a pending throw wins over an error from closing, and otherwise a close error propagates and a non-object result is a `TypeError`. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 68b).
- **Amended 2026-10-30: the spec states destructuring-default behavior, not a lowering.** This replaces the lowering recipes of the three amendments above; their behavior stands. In effect code a destructuring pattern behaves exactly as ECMAScript destructuring (ECMA-262 BindingInitialization, GetIterator, IteratorClose): evaluation order, getters, the iterator protocol, `IteratorClose` only when the native algorithm requires it, with a pending throw winning over a close error, and native error kinds and messages. A default's `try` and `yield` run in the enclosing effect function; a `do` default's `return`, `break` and `continue` act on the enclosing function or loop. How the compiler achieves it is its choice. The witnesses are normative examples with their Exits: `effect function f() { const { x = do { return 9 } } = {}; return 0 }` succeeds with 9, `effect function g() { const { x = do { try succeed(7) } } = {}; return x }` succeeds with 7, and `const [x = do { try succeed(7); bad.value }] = xs` dies with `"body"` when `bad.value` throws `"body"` and `return` throws, and with a `TypeError` when `bad.value` completes normally and `return` returns `1`; round 20 adds a replaced global `Symbol` (success) and malformed iterator methods, results, `next` and `return` (each the native `TypeError`) ([Running Effects](../src/002-running.md#destructuring-and-parameter-defaults)). Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 68c).
- **Amended 2026-10-30: jumps in defaults, and no recipes.** A `return`, `break` or `continue` in a destructuring default leaves the pattern as the same jump leaves a `for…of` body: an array pattern closes its iterator unless it is done, and an error from closing replaces the jump. A `return` in a parameter default stays legal, as the pinned proposal says, and acts as `return` at the top of the body: a plain function returns the value, an `async` function fulfills with it, an `effect` function's call gives an Effect that succeeds with it, and a generator's call gives a generator that finishes with it without starting the body (Will, 2026-10-30: "everything about the do expreession should work liike that spec"). A throw there follows the kind of function, so an `effect` function's call gives an Effect that dies and never throws. The behavior replaces the moved-default lowering of the amendments above, including its temporal-dead-zone exception: JavaScript has none, so VibeLang has none. A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".

- **Amended 2026-10-30: source completion types.** `do` uses the source block's normal completion values and `UpdateEmpty` flow, including locally consumed jumps. Only a final empty completion becomes `undefined`; paths leaving outward contribute no result, and no normal path means `never`. Its fresh literals and contextual typing follow ordinary expressions: `const x = do { 1 }` keeps `1`, `let x = do { 1 }` widens to `number`, and annotations/const assertions follow TypeScript. Context reaches result alternatives, while discarded expressions and outward returns retain their own contexts. Generated functions and temporaries never choose source overloads or declaration types.

## Amendment: mixed block modifier recovery

The mixed heads `effect async { B }` and `async effect { B }` parse for recovery and report `EK0105` (VIP-1). Remove `async` to recover the ordinary cold Effect block. A bare `async { B }` is not a language form; the recovery adds no accepted syntax or runtime counterpart.

## Prior art

- Rust: `async fn` is a function, and `async { }` is the value.
- F#'s `async { }`, Kotlin's `suspend { }`, TC39's `async do { }` proposal.
- Effect's `Effect.gen`.
- TC39 do expressions (stage 1).

## Will's words

> "No no exceptions do should just be shorthand for an iiffe and have exact same spec as tc39 proposal"

> "Ok I approve this one"

*Updated by VIP-5 (2026-10-28): examples use `try` to run Effects. Updated by VIP-7: the proposal is pinned to a dated snapshot.*

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


- D322's exception, under which a `do { }` element of an await operation became a program.
- D551's conversion of a function literal at an `Effect` parameter. This follows from VIP-1's "syntax decides".
- The function-literal conversion of D480, where the parameter's type decided.
