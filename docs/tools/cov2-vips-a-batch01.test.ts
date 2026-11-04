// Rule-specific pending obligations from the cov2-vips-a assignment.
// Pending because focused compiler and Effect TypeScript witnesses remain unverified.
// These declarations make no claim that the compiler fails or conforms.
import { test } from "bun:test"

// rule-evidence: docs/design/vips/0001-effect-and-async-functions.md#f744227ed40c4eb0
// VIP-1: legacy JavaScript boundaries
test.todo("VIP-1 legacy JavaScript boundaries: Legacy JavaScript lives in `.ts`/`.js` files and `module` bodies (VIP-40).")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#ea174ed61d5aac55
// VIP-2: host console ban in effect blocks
test.todo("VIP-2 host console ban in effect blocks: **Corrected 2026-10-31: the first example logs with `log`.** It wrote `console.log(\"hi\")`, a host global that VIP-33 bans in every `.vibe` context, an `effect` block included.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#9ce4336eaafe0d2f
// VIP-2: cold logging reruns
test.todo("VIP-2 cold logging reruns: `try log(\"hi\")` runs Effect's `log` global (VIP-6) once per run of `p`, so the example still shows a cold block that reruns.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#49eeee40c00283b7
// VIP-2: effect block generator equivalence
test.todo("VIP-2 effect block generator equivalence: It is Effect TS's `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#bb999da55b72611e
// VIP-2: effect function returns an Effect
test.todo("VIP-2 effect function returns an Effect: `effect` before a function makes a function that returns an Effect (VIP-1).")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#03c8b33efd160756
// VIP-2: effect block is an Effect value
test.todo("VIP-2 effect block is an Effect value: `effect` before a block makes the Effect itself.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#cea30281bdb61cd5
// VIP-2: pinned do expression grammar
test.todo("VIP-2 pinned do expression grammar: `do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal (moved deliberately, as VIP-7 does for `match`), everywhere, with no exceptions.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#4ba8de1461fc41e2
// VIP-2: do suspension belongs to enclosing function
test.todo("VIP-2 do suspension belongs to enclosing function: As TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#1b98236c192b9c22
// VIP-2: native do jump rules
test.todo("VIP-2 native do jump rules: **Amended 2026-10-29: `do` follows TC39 exactly.** VibeLang adds no limits on `var`, `break` or `continue` inside a `do` block (the old EK1019 is deleted).")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#cd4d5474cd86cbec
// VIP-2: dated proposal snapshot
test.todo("VIP-2 dated proposal snapshot: **Amended 2026-10-29: the pinned snapshot.** `do` is pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1`, the head on 2026-10-28 (UTC), vendored in [`tc39-do-expressions/`](tc39-do-expressions/README.md), as pattern matching is pinned.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#2b50a17b8af96026
// VIP-2: empty switch static predicate
test.todo("VIP-2 empty switch static predicate: **Amended 2026-10-30: complete the pinned static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#4959d94a640a09cc
// VIP-2: effect loop static predicate
test.todo("VIP-2 effect loop static predicate: Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#8eb1fb833fa20f1d
// VIP-2: loop IsEmpty and IsBreak
test.todo("VIP-2 loop IsEmpty and IsBreak: The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#b204385f1951e5f4
// VIP-2: parameter return preserves function length
test.todo("VIP-2 parameter return preserves function length: **Amended 2026-10-30: `return` in a `do` in a parameter default.** A parameter list whose `do` contains a `return` lowers by moving every default from that parameter on into the body, so the `return` returns from the function; `length` is unchanged.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#d698acb92a1a0a73
// VIP-2: guarded default activation and order
test.todo("VIP-2 guarded default activation and order: **Amended 2026-10-30: defaults that suspend or jump stay in the enclosing activation.** A parameter or destructuring default containing `try`, `await`, `yield`, or a `do` whose `return`, `break` or `continue` leaves the default, lowers into guarded statements in the enclosing function at the default's place, never into an arrow, keeping the pattern's evaluation order and its other bindings.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#a43786f3c5123eb1
// VIP-2: destructuring default returns nine
test.todo("VIP-2 destructuring default returns nine: `effect function f() { const { x = do { return 9 } } = {}; return 0 }` succeeds with 9.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#1736c1aea898d47a
// VIP-2: native expression defaults close iterators
test.todo("VIP-2 native expression defaults close iterators: **Amended 2026-10-30: defaults stay native where they can; expanded ones close iterators exactly.** A destructuring default whose suspending `do` (or `try`/`await`) lowers to one expression stays native destructuring in the generator: `const [x = do { try succeed(7); bad.value }] = xs` is `const [x = (yield* Effect.succeed(7), bad.value)] = xs`, so ECMAScript's own evaluation order and IteratorClose apply.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#02504e98afe0c9ca
// VIP-2: expanded defaults use IteratorClose precedence
test.todo("VIP-2 expanded defaults use IteratorClose precedence: Only a default with a statement that is not an expression, or a `return`, `break` or `continue` leaving it, uses the expanded statements, which close the iterator by ECMA-262 IteratorClose: `return` is called on the iterator, a pending throw wins over an error from closing, and otherwise a close error propagates and a non-object result is a `TypeError`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#2bc6eb46112df039
// VIP-2: native destructuring protocol and errors
test.todo("VIP-2 native destructuring protocol and errors: In effect code a destructuring pattern behaves exactly as ECMAScript destructuring (ECMA-262 BindingInitialization, GetIterator, IteratorClose): evaluation order, getters, the iterator protocol, `IteratorClose` only when the native algorithm requires it, with a pending throw winning over a close error, and native error kinds and messages.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#83586f86092abb67
// VIP-2: default suspension and jump targets
test.todo("VIP-2 default suspension and jump targets: A default's `try` and `yield` run in the enclosing effect function; a `do` default's `return`, `break` and `continue` act on the enclosing function or loop.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#f6c36e2159f0c8a5
// VIP-2: normative default Exit witnesses
test.todo("VIP-2 normative default Exit witnesses: The witnesses are normative examples with their Exits: `effect function f() { const { x = do { return 9 } } = {}; return 0 }` succeeds with 9, `effect function g() { const { x = do { try succeed(7) } } = {}; return x }` succeeds with 7, and `const [x = do { try succeed(7); bad.value }] = xs` dies with `\"body\"` when `bad.value` throws `\"body\"` and `return` throws, and with a `TypeError` when `bad.value` completes normally and `return` returns `1`; round 20 adds a replaced global `Symbol` (success) and malformed iterator methods, results, `next` and `return` (each the native `TypeError`) ([Running Effects](../src/002-running.md#destructuring-and-parameter-defaults)).")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#a13aab64f9f6abb1
// VIP-2: jump replacement by iterator close errors
test.todo("VIP-2 jump replacement by iterator close errors: **Amended 2026-10-30: jumps in defaults, and no recipes.** A `return`, `break` or `continue` in a destructuring default leaves the pattern as the same jump leaves a `for…of` body: an array pattern closes its iterator unless it is done, and an error from closing replaces the jump.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#fcd193ff44c58091
// VIP-2: parameter return across function kinds
test.todo("VIP-2 parameter return across function kinds: A `return` in a parameter default stays legal, as the pinned proposal says, and acts as `return` at the top of the body: a plain function returns the value, an `async` function fulfills with it, an `effect` function's call gives an Effect that succeeds with it, and a generator's call gives a generator that finishes with it without starting the body (Will, 2026-10-30: \"everything about the do expreession should work liike that spec\").")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#54acaff692d7ed8c
// VIP-2: effect parameter throws become defects
test.todo("VIP-2 effect parameter throws become defects: A throw there follows the kind of function, so an `effect` function's call gives an Effect that dies and never throws.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#22aff18d6e94a3b4
// VIP-2: expression evaluation position
test.todo("VIP-2 expression evaluation position: A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#581194397bdbd153
// VIP-2: source completion and UpdateEmpty
test.todo("VIP-2 source completion and UpdateEmpty: **Amended 2026-10-30: source completion types.** `do` uses the source block's normal completion values and `UpdateEmpty` flow, including locally consumed jumps.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#b01882fa06cd5ee9
// VIP-2: empty and abrupt completion result types
test.todo("VIP-2 empty and abrupt completion result types: Only a final empty completion becomes `undefined`; paths leaving outward contribute no result, and no normal path means `never`.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#b9249d13731a904f
// VIP-2: fresh literals and contextual typing
test.todo("VIP-2 fresh literals and contextual typing: Its fresh literals and contextual typing follow ordinary expressions: `const x = do { 1 }` keeps `1`, `let x = do { 1 }` widens to `number`, and annotations/const assertions follow TypeScript.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#a8e1f42f157b1c5d
// VIP-2: mixed block heads report EK0105
test.todo("VIP-2 mixed block heads report EK0105: The mixed heads `effect async { B }` and `async effect { B }` parse for recovery and report `EK0105` (VIP-1).")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#08dee614e3b57b98
// VIP-2: remove async quick fix
test.todo("VIP-2 remove async quick fix: Remove `async` to recover the ordinary cold Effect block.")

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#2c18e0a55c2e7e51
// VIP-2: bare async block rejection
test.todo("VIP-2 bare async block rejection: A bare `async { B }` is not a language form; the recovery adds no accepted syntax or runtime counterpart.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#e20b7a8d84b7cb50
// VIP-3: Effect shorthand line boundary
test.todo("VIP-3 Effect shorthand line boundary: **Amended 2026-10-30: a line break ends an Effect type.** Each `!`, and the slot after it, start on the line where the previous slot ends; a slot in parentheses may span lines.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#e28967693d877faa
// VIP-3: postfix type newline diagnostics
test.todo("VIP-3 postfix type newline diagnostics: TypeScript stops its postfix type operators at a preceding line break, and a slot has no closing token, so `now(): number!!` then `later(): number!!` stay two members and a `!` with no slot on its line is TS17019.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#26cd1ca9d30326dc
// VIP-3: omitted slot migration warning
test.todo("VIP-3 omitted slot migration warning: **Amended 2026-10-30: migration warning.** The transitional compiler reports `EK4853` when `--fix` can preserve requirements that the retired omitted-slot rule inferred by writing them explicitly.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#e64fec7c8711deec
// VIP-3: position sensitive migration rewrite
test.todo("VIP-3 position sensitive migration rewrite: The quick fix and `--fix` write `A!E!R` where it means the same type in that position without new parentheses, and `Effect.Effect<A, E, R>` through the real `Effect` namespace binding everywhere else: `Effect<number>` becomes `number!!`, while `Effect<A | B, E>`, `Effect<A, E>[]` and an `extends` or `implements` heritage element get the qualified form.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#c2c3e981b82756f9
// VIP-3: qualified declaration emission
test.todo("VIP-3 qualified declaration emission: Emitted declarations already print `Effect.Effect<…>` and do not change (decided detail 260, 2026-11-02).")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#b201ac8a05132a36
// VIP-3: explicit Effect slots and omitted never
test.todo("VIP-3 explicit Effect slots and omitted never: **Amended 2026-11-03: written `infer` slots retire.** An annotation means what the same annotation means on the equivalent Effect TypeScript: `A!E!R` is `Effect.Effect<A, E, R>`, and omitted slots are `never`.")

// rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#8d8a2ea87dba87a5
// VIP-3: ordinary conditional infer
test.todo("VIP-3 ordinary conditional infer: Ordinary conditional-type `infer` remains as in TypeScript.")

// rule-evidence: docs/design/vips/0004-throw.md#934b2a897a4a8998
// VIP-4: async throw rejects Promise
test.todo("VIP-4 async throw rejects Promise: `throw` in an `async` function rejects its Promise, as in TypeScript.")

// rule-evidence: docs/design/vips/0004-throw.md#d08627067b207a03
// VIP-4: plain throw and throwing calls report EK0401
test.todo("VIP-4 plain throw and throwing calls report EK0401: `throw` in any other `.vibe` code, or a call known to throw there outside the `try` block of a `try`/`catch` statement, is `EK0401`.")
