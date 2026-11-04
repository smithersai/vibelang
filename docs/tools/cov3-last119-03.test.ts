// Complete compiler/native verification deferred for these individual obligations.
// Pending does not assert that the compiler fails the rule.
import { test } from "bun:test"

// rule-evidence: docs/design/src/900-appendices.md#35f9f11e05e7dd73 — Chapter 900: empty switch do static predicate
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: empty switch do static predicate — **Do snapshot static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal.")

// rule-evidence: docs/design/src/900-appendices.md#5a05926aa18cdc42 — Chapter 900: pipe topic early error boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: pipe topic early error boundary — **Pipe snapshot reconciliations.** The missing-topic early error checks the `AssignmentExpression` child with `ContainsOuterTopic`; the `PipeBody` boundary still returns `false`.")

// rule-evidence: docs/design/src/900-appendices.md#3bad5dbbdd4d1d46 — Chapter 900: pipe input GetValue once
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: pipe input GetValue once — Evaluation uses the actual `ShortCircuitExpression` input once, with `GetValue`, rather than the stale `ConditionalExpression` reference.")

// rule-evidence: docs/design/src/900-appendices.md#6f8785367214483e — Chapter 900: primary topic environment
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: primary topic environment — `GetPrimaryTopicValue` reads `topicEnv.[[TopicValues]]`, not the unbound `envRec`.")

// rule-evidence: docs/design/src/900-appendices.md#7abde2cf1d1fc0f1 — Chapter 900: native XOR operators
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: native XOR operators — Binary XOR `^` and XOR assignment `^=` remain ordinary TypeScript operators despite the duplicated `%` in the token table.")

// rule-evidence: docs/design/src/900-appendices.md#111291658e11e009 — Chapter 900: catch precedence and associativity
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: catch precedence and associativity — **`catch`.** [CatchExpression](#catchexpression) sits in ECMAScript's precedence chain beside `CoalesceExpression`, and its head mirrors `CoalesceExpressionHead`: it binds like `??`, is left-associative, and can't be mixed with `??`, `||` or `&&` without parentheses, for the same structural reason `a ?? b || c` is a syntax error.")

// rule-evidence: docs/design/src/900-appendices.md#6101387d3fa837bd — Chapter 900: literal catch handler kind
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: literal catch handler kind — The handler is a plain or `effect` arrow or function expression, possibly parenthesized, so its kind is decided by its syntax alone; any other handler is `EK0509` ([Running Effects](002-running.md#catch)).")

// rule-evidence: docs/design/src/900-appendices.md#cec785777f6e82b5 — Chapter 900: Effect type line termination
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect type line termination — One rule explains every `[no LineTerminator here]` in the productions: a line break ends an Effect type.")

// rule-evidence: docs/design/src/900-appendices.md#aff6a56387710248 — Chapter 900: native postfix type line termination
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: native postfix type line termination — TypeScript stops its postfix type operators (`!`, `?`, `[]`) at a preceding line break, so in `x as User` followed by a line `!flag && fail()`, the type ends at `User`.")

// rule-evidence: docs/design/src/900-appendices.md#7f601b21f08ea1e2 — Chapter 900: same-line Effect slot start
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: same-line Effect slot start — A `[]` has a closing token and a slot doesn't, so the slot starts on the line of its `!`, which keeps `now(): number!!` and `later(): number!!` two members.")

// rule-evidence: docs/design/src/900-appendices.md#ed7184068a58109d — Chapter 900: optional object requirement grouping
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional object requirement grouping — `R` after `!!` never starts with `{`; write `A!!({ … })` for a type-literal requirement.")

// rule-evidence: docs/design/src/900-appendices.md#bd15ef21a0958200 — Chapter 900: contextual bang rescanning
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: contextual bang rescanning — In a type, directly after `A!`, where the next `!` completes `A!!`, the scanner reads that `!` alone and rescans from the next character (`=`, `==`, `===` or `=>`), as TypeScript rescans `>` after type arguments only on demand; anywhere else `!=` and `!==` stay equality operators.")

// rule-evidence: docs/design/src/900-appendices.md#ee38565f327ba156 — Chapter 900: Effect type grammar alternative
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect type grammar alternative — `EffectType` is an alternative of TypeScript's `Type`, beside a function type and a conditional type.")

// rule-evidence: docs/design/src/900-appendices.md#9906a9a8b16125fa — Chapter 900: function return Effect type grouping
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: function return Effect type grouping — A function or constructor type's return is a `Type`, so `() => A!E` is `() => (A!E)`, as `() => A | B` is `() => (A | B)` (VIP-3, amended).")

// rule-evidence: docs/design/src/900-appendices.md#c8601aaf436cc359 — Chapter 900: Effect type operand binding
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect type operand binding — Each operand sits at the type-operator level, so prefix and postfix operators bind tighter than `!`.")

// rule-evidence: docs/design/src/900-appendices.md#78fe099476011694 — Chapter 900: single dangling bang repair
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: single dangling bang repair — A `!` after a type with no slot and no second `!` after it on its line is a syntax error, as in TypeScript (TS17019); the quick fix parenthesizes: `(x as Foo)!`.")

// rule-evidence: docs/design/src/900-appendices.md#82d0bcc660939337 — Chapter 900: unambiguous double bang type
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: unambiguous double bang type — `T!!` is always an `EffectType`.")

// rule-evidence: docs/design/src/900-appendices.md#8b09317cf9d1a2f0 — Chapter 900: union Effect shorthand grouping
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: union Effect shorthand grouping — `(A | B)!E` is `Effect.Effect<A | B, E>`; `A | (B!E)` is `A | Effect.Effect<B, E>`.")

// rule-evidence: docs/design/src/900-appendices.md#49f5d7ebd5c39425 — Chapter 900: greedy member type boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: greedy member type boundary — **Fields.** A field's `Type` is parsed greedily, as in a TypeScript type member; then the field ends at `;`, `,`, a line break or `}`, so `{ a: string b: number }` is a syntax error and a union may continue on the next line:")

// rule-evidence: docs/design/src/900-appendices.md#47720fd4502aabc4 — Chapter 900: variant body newline
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: variant body newline — A variant's `{` may follow a line break, as an error body's may; a line break before `{` is not a separator, so `data D { A` then `{ x: string } }` gives `A` the field `x`.")

// rule-evidence: docs/design/src/900-appendices.md#d15e6ffd719b26b1 — Chapter 900: readonly payload fields
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: readonly payload fields — `readonly` is allowed on any field; `error` and `data` fields are readonly either way.")

// rule-evidence: docs/design/src/900-appendices.md#790774756167f89e — Chapter 900: empty tagged enum
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: empty tagged enum — `data Empty {}` has no variants; it is an empty `Data.TaggedEnum`.")

// rule-evidence: docs/design/src/900-appendices.md#f8099cea7d10481f — Chapter 900: service member alternatives
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: service member alternatives — The alternatives don't overlap: a member that parses as a `Field`, `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` is that member, never a rejected one, so `service S { a: number, b: string }` uses interface separators.")

// rule-evidence: docs/design/src/900-appendices.md#b586842a71a2fa52 — Chapter 900: retired catch throw diagnostic
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: retired catch throw diagnostic — The old `EK0511` is retired too: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`.")

// rule-evidence: docs/design/src/900-appendices.md#aa456f78debc4f8a — Chapter 900: synchronous no-throw context matrix
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: synchronous no-throw context matrix — | `EK0401` | a `throw`, or a call known to throw outside the `try` block of a `try`/`catch` statement, in synchronous `.vibe` code outside effect code; any thrown type other than `never` in a plain function whose return type is wholly effectful, or in an effectful function's parameter list | 4, 5, 7 | [Failures](003-failures.md#plain-code-never-throws) |")

// rule-evidence: docs/design/src/900-appendices.md#bda9313d164953c6 — Chapter 900: platform import and callback severity
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: platform import and callback severity — | `EK4402` | interim warning inside formerly accepted boundary callbacks; error otherwise: a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), a string-literal `import(…)` of one, or a statically named value that [reaches the platform](005-services.md#reaches-the-platform): a global declared by `lib.dom`, `lib.webworker`, `lib.scripthost` or `@types/node` and not by `lib.es*` or `lib.decorators*`, minus the allowlist, or a banned member of an allowlisted global, in a `.vibe` file | 33 | [Services](005-services.md#the-platform-standard-library) |")

// rule-evidence: docs/design/src/900-appendices.md#a1d4c61f4a7e5703 — Chapter 900: escaped expected-error contract
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: escaped expected-error contract — | interim `EK9201` | error: an expected failure escapes the written error contract | 1, 3 | Ordinary checked Effect return types and assignability |")

// rule-evidence: docs/design/src/900-appendices.md#82677ed56820e47a — Chapter 900: escaped requirement contract
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: escaped requirement contract — | interim `EK9202` | error: a requirement escapes the written requirement contract | 1, 3 | Ordinary checked Effect return types and assignability |")

// rule-evidence: docs/design/src/900-appendices.md#efc88709f48db4d2 — Chapter 900: legacy infallible catch retirement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: legacy infallible catch retirement — | interim `EK9204` | warning: an old Effect `try`/`catch` statement has no expected errors, or the head of a `catch` expression cannot fail, reported at its `catch` keyword | 5 | Statement: Effect code has no `try` statement (`EK0503`); an infallible Effect is still run with `try e`.")

// rule-evidence: docs/design/src/900-appendices.md#5da78066df93ef5e — Chapter 900: infallible catch expression validity
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: infallible catch expression validity — Expression: `succeed(2) catch (e) => 0` is valid; the warning retires with no successor |")

// rule-evidence: docs/design/src/900-appendices.md#5c3b09c09ca752e8 — Chapter 900: compiler do gap diagnostic
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: compiler do gap diagnostic — The compiler also prints `EK0204`, a compiler gap rather than a language rule.")

// rule-evidence: docs/design/src/900-appendices.md#1bef786019a4ac2b — Chapter 900: do parameter return completion
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: do parameter return completion — In particular, `function f(x = do { return null }) {}` returns `null` from `f`; the code retires when the compiler lowers those positions.")

// rule-evidence: docs/design/src/900-appendices.md#09f48b65f0baf24d — Chapter 900: do completion gap meaning
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: do completion gap meaning — | `EK0204` | compiler gap, not a language rule: a `return`, `var`, jump, `await` or `yield` that would leave a `do` the compiler still compiles to a function; admitted completions keep VIP-2’s meaning | 2 | [Running Effects](002-running.md#do-expressions) |")

// rule-evidence: docs/design/src/900-appendices.md#51f3557fec7743d8 — Chapter 900: native using and scoped resources
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: native using and scoped resources — | [8](../vips/0008-using-denied.md) | special syntax for Effect resources (`using` with Effect meaning, a `scoped` keyword) | `using` is TypeScript's; Effect resources use `scoped(effect { … })` |")

// rule-evidence: docs/design/src/900-appendices.md#d46aee74a74ff5b7 — Chapter 900: legacy trailing block preserving migration
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: legacy trailing block preserving migration — | [11](../vips/0011-trailing-blocks-denied.md) | trailing blocks, `f(x) { … }` | `f(x, () => { … })`, `f(x, effect () => { … })` or `f(x, effect { … })`, as the proven legacy lowering chooses; refuse an unproved choice (VIP-11) |")

// rule-evidence: docs/design/src/900-appendices.md#ec21c02b4d57759a — Chapter 900: wire retirement replacement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: wire retirement replacement — | [24](../vips/0024-wire-denied.md) | `wire`, automatic layer composition | Effect's `Layer.provide` and `Layer.provideMerge` |")

// rule-evidence: docs/design/src/900-appendices.md#0e96dab754b64151 — Chapter 900: schema error constructor defect
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: schema error constructor defect — | the constructor of `Schema.TaggedError`: `new Invalid({ … })` for a `schema error` | `@throws {never}`, as for `error` and `data`: a bad field at construction throws a plain `Error`, a defect: `effect { throw new Invalid({ name: \"\" }) }` dies |")

// rule-evidence: docs/design/src/900-appendices.md#741c0b2e4ac2b518 — Chapter 900: throw forbidden punctuator diagnostic
// rule-evidence: docs/design/src/900-appendices.md#ee6dad61ca20a90c — Chapter 900: throw punctuator severity amendment
// The assigned table row changed upstream; verify comma warning, operator-left error, and the preserving repair.
test.todo("Chapter 900: throw punctuator diagnostic \u2014 assigned trigger retained; current comma-only violation warns until its fix ships; existing operator-left violations remain errors.")
