// Rule-specific obligations whose complete compiler/native verification is deferred.
// TODO is an explicit pending classification, not evidence of conformance or a reproduced mismatch.
import { test } from "bun:test"

// rule-evidence: docs/design/src/005-services.md#effa02d5aded0fd3 — Chapter 005: legacy boundary callback severity
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 005: legacy boundary callback severity — During migration, `EK4402` in a formerly accepted `sync`, `callback`, `Effect.try` or `Effect.tryPromise` callback is a warning.")

// rule-evidence: docs/design/src/007-tooling.md#01391efa8760ae12 — Chapter 007: synchronous defect bridge import hygiene
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 007: synchronous defect bridge import hygiene — Generated synchronous defect bridges use `Effect.orDie(Effect.try({ try: () => call(), catch: identity }))` with `identity` from `effect/Function`, reusing an existing visible import or choosing an unshadowed binding.")

// rule-evidence: docs/design/src/900-appendices.md#d5468a2f4b83ea40 — Chapter 900: vibex grammar and JSX variant
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: vibex grammar and JSX variant — This appendix is the only place a VibeLang production is written, and a `.vibex` file uses these productions unchanged, read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md) adds no production); chapters show examples and link here by production name.")

// rule-evidence: docs/design/src/900-appendices.md#19ffe070e9d9d885 — Chapter 900: Effect grammar parameter
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect grammar parameter — VibeLang adds one grammar parameter, `[Effect]`, with the contextual boundaries below, following [TypeScript’s parser](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/parser.ts).")

// rule-evidence: docs/design/src/900-appendices.md#eda83de19217574f — Chapter 900: Effect callable parameter and body contexts
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect callable parameter and body contexts — The parameters and body of an `effect` function, arrow, method or producer, and the body of an `effect` block, parse with `[+Effect]`.")

// rule-evidence: docs/design/src/900-appendices.md#06e1828e9967b3df — Chapter 900: plain callable and async match contexts
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: plain callable and async match contexts — The body of any source callable without an `effect` modifier parses with `[~Effect]`, retaining TypeScript’s own `[Await]` and `[Yield]` rules; an `async match` parses with `[~Effect, +Await]`, as a nested `async` function.")

// rule-evidence: docs/design/src/900-appendices.md#882b91d91f357e06 — Chapter 900: ordinary IdentifierName properties
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: ordinary IdentifierName properties — They stay ordinary `IdentifierName`s, as `await` does: `parts.join(\",\")`, `o?.fork`, `{ join: 1 }` and `class { join() { } }` are names.")

// rule-evidence: docs/design/src/900-appendices.md#9442bab15a4474c5 — Chapter 900: fiber regex and newline operands
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: fiber regex and newline operands — After the keyword, `/` begins a regular expression, and the operand may follow a line break, as after `await`: `join` then `f` on the next line joins `f`.")

// rule-evidence: docs/design/src/900-appendices.md#8eca98c7370ba3e6 — Chapter 900: plain fiber identifier context
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: plain fiber identifier context — Under `[~Effect]` those productions don't exist, and `fork` and `join` are identifiers.")

// rule-evidence: docs/design/src/900-appendices.md#da424a77a71e960a — Chapter 900: outside Effect recovery
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: outside Effect recovery — As TypeScript parses `await x` in a plain function to report \"only allowed in async functions\", a parser recovers by parsing these productions under `[~Effect]` and reports the construct's \"outside effect code\" rule, except where the tokens are also valid TypeScript, which keep their TypeScript meaning.")

// rule-evidence: docs/design/src/900-appendices.md#2d23b461ac301911 — Chapter 900: provide statement versus division
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide statement versus division — A [ProvideStatement](#providestatement) head is the exception: it wins in any code (VIP-12, amended), so the statement `provide / a / { }` in `function f(provide: number, a: number) { provide / a / { } }` is `EK1201`; after `return` no statement can start, so `return provide / a / { }` divides.")

// rule-evidence: docs/design/src/900-appendices.md#1b4fcdea9fcaafaa — Chapter 900: declaration contextual keyword boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: declaration contextual keyword boundary — <a id=\"declaration-keywords\"></a>**Declaration keywords.** `service`, `error`, `schema` and `data` follow TypeScript's contextual keyword `type`, whose alias declaration is `type` [no LineTerminator here] `BindingIdentifier`.")

// rule-evidence: docs/design/src/900-appendices.md#0e7f6e4c1fc1955f — Chapter 900: declaration start longest alternative
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: declaration start longest alternative — Where a TypeScript declaration can start (a `StatementListItem`, or after `export`), a `DeclarationStart` begins that declaration, longest alternative first.")

// rule-evidence: docs/design/src/900-appendices.md#b2fbcdabe50fb521 — Chapter 900: contextual identifiers in expressions
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: contextual identifiers in expressions — Anything else is ordinary TypeScript, where the word is an identifier: `const error = …`, `catch (error)`, `const e = error as Error`, `return data as User[]`, `const ok = schema satisfies Schema.Top` and `error instanceof NotFound;` (a reserved word is not a `BindingIdentifier`).")

// rule-evidence: docs/design/src/900-appendices.md#f76c3b9e24cc4b29 — Chapter 900: declaration body line breaks
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: declaration body line breaks — After the name, the declaration's production decides the rest, and line breaks may separate its tokens as in a TypeScript `class` or `type` declaration: a body's `{` and a `schema` alias's `=` may follow line breaks.")

// rule-evidence: docs/design/src/900-appendices.md#b1a0d6ca178e887a — Chapter 900: effect contextual head inventory
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: effect contextual head inventory — | `effect` | `function`; an arrow head, as for `async`: `(` … `)` then `=>`, `<` type parameters of such an arrow, or an identifier then `=>`; in a class or object literal: a method name (`ClassElementName`, `#m` included) then `(` or `<`, `*`, or `get` or `set` then a name ([EffectAccessor](#effectaccessor)), as TypeScript parses `async get x()`; on an `interface` or type literal member: a member name or `[`, where TypeScript parses an `async` modifier and reports TS1070 or TS1071, so that `EK0108` reports it; at a statement start, a name other than `as`, `satisfies` or `is`, then `(` or `<` ([EffectShorthand](#effectshorthand)); `{` in an expression position only, so in a heritage clause (`class C extends effect { }`, `class C implements effect { }`, `interface I extends A, effect { }`) `effect` is an identifier and `{` starts the body, as in TypeScript.")

// rule-evidence: docs/design/src/900-appendices.md#5dd1950a1c4d35e8 — Chapter 900: effect multiplication call and heritage controls
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: effect multiplication call and heritage controls — `effect * rate` is a multiplication; `effect(x)` with no `=>` is a call; `class C extends effect { }` extends a value named `effect`.")

// rule-evidence: docs/design/src/900-appendices.md#2b3b3eaef53ac9b6 — Chapter 900: provide bounded recovery
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide bounded recovery — | `provide` | at a statement start when a valid [ProvideStatement](#providestatement) head parses, or bounded recovery relaxes only line breaks immediately before/after top-level provider commas; the ordinary provider grammar, no break after `provide` and same-line final `{` still apply; otherwise an identifier | [Services](005-services.md#provide-blocks) |")

// rule-evidence: docs/design/src/900-appendices.md#3b36f29bd166524b — Chapter 900: not prefix syntactic priority
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: not prefix syntactic priority — | `match`, `when`, `is`, `and`, `or`, `not` | as TC39's pattern-matching proposal says; where both parses exist, prefix `not` wins syntactically over a member/extractor rooted at an identifier `not`, before early errors and without consulting bindings | [Pattern matching](004-match.md) |")

// rule-evidence: docs/design/src/900-appendices.md#a6eb96e69bfbee76 — Chapter 900: decorator placement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: decorator placement — `DecoratorList` is TypeScript's class decorator list and is admitted only on class elements, with TypeScript placement checks; an object-literal method has none.")

// rule-evidence: docs/design/src/900-appendices.md#6158ab008bf755f7 — Chapter 900: async effect accessor diagnostics
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: async effect accessor diagnostics — `async effect get x() { }` gets both `EK0104` and `EK0105`.")

// rule-evidence: docs/design/src/900-appendices.md#8bad0f21ebbd88d6 — Chapter 900: shorthand expression operator controls
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: shorthand expression operator controls — The identifier-spelled expression operators `as`, `satisfies` and `is` retain their expression reading after a value named `effect` or `async`; they cannot select recovery for an invalid function shorthand.")

// rule-evidence: docs/design/src/900-appendices.md#e52265e65e1b03f8 — Chapter 900: is expression runtime result
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: is expression runtime result — In particular, both statements below are VIP-7 `is` expressions, and the Effect succeeds with `2`:")

// rule-evidence: docs/design/src/900-appendices.md#233e0b31432272ab — Chapter 900: inherited production parameters
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: inherited production parameters — These productions carry the enclosing `In`, `Yield`, `Await` and `Effect` grammar parameters consistently.")

// rule-evidence: docs/design/src/900-appendices.md#d423921e53c2feae — Chapter 900: pipe covering restriction
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: pipe covering restriction — Alongside the pinned covering-production restrictions on conditional, yield, assignment and arrow bodies, an `EffectArrow` included, reject a body whose whole unparenthesized expression is a `PipeExpression`.")

// rule-evidence: docs/design/src/900-appendices.md#21d1f9f751f8caf3 — Chapter 900: optional requirement present parse
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional requirement present parse — At the optional `R` boundary after `!!`, prefer the present `R` among complete source parses when the following tokens on that line start a valid ordinary TypeScript source operand, except the existing unparenthesized `{` exclusion.")

// rule-evidence: docs/design/src/900-appendices.md#7c4a8564647d35b3 — Chapter 900: negative literal requirement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: negative literal requirement — A negative literal type is such an operand: `x as A!! - 1` consumes `-1` as `R`.")

// rule-evidence: docs/design/src/900-appendices.md#62e1eae1b15e269d — Chapter 900: syntax-only requirement choice
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: syntax-only requirement choice — This choice uses syntax, with no symbol lookup or whitespace distinction; parenthesize the whole omitted-`R` assertion before a following subtraction.")

// rule-evidence: docs/design/src/900-appendices.md#9579c9b3ec53d3dc — Chapter 900: JSDoc slot rejection
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: JSDoc slot rejection — The parser-only JSDoc forms `?T`, `T?`, `!T` and `*` are excluded, including inside parentheses; explicitly writing one gives the ordinary invalid-type diagnostic.")

// rule-evidence: docs/design/src/900-appendices.md#10ff145d302ab492 — Chapter 900: optional slot expression operators
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional slot expression operators — At the optional-slot boundary, `?` and `*` instead remain expression operators where the surrounding expression admits them.")

// rule-evidence: docs/design/src/900-appendices.md#c29656fd967f6205 — Chapter 900: additional bang scanning
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: additional bang scanning — An additional `!` follows the existing bang and non-null rules, rather than starting a JSDoc requirement.")

// rule-evidence: docs/design/src/900-appendices.md#b8da47725a0ea3b4 — Chapter 900: optional requirement body exclusion
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional requirement body exclusion — The unparenthesized `{` exclusion applies only to the optional `R` after `!!`, leaving a following function body available.")

// rule-evidence: docs/design/src/900-appendices.md#5c439b412f1dc424 — Chapter 900: required object slots
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: required object slots — A required error or requirement slot admits an ordinary object type: `A!{ reason: string }!{ service: number }` means `Effect.Effect<A, { reason: string }, { service: number }>`.")

// rule-evidence: docs/design/src/900-appendices.md#cd7fb6304a178700 — Chapter 900: parenthesized omitted-error object requirement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: parenthesized omitted-error object requirement — The omitted-error spelling still needs `A!!({ service: number })` for that requirement.")

// rule-evidence: docs/design/src/900-appendices.md#a990eb49461c0275 — Chapter 900: optional tuple Effect type
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional tuple Effect type — An enclosing TypeScript tuple can mark the completed Effect type as an optional tuple element: `[A!E?]` means `[(Effect.Effect<A, E>)?]`, `[A!!?]` means `[(Effect.Effect<A>)?]`, and `[A!!-1?]` means `[(Effect.Effect<A, never, -1>)?]`.")

// rule-evidence: docs/design/src/900-appendices.md#58d0bf5fd15232a4 — Chapter 900: expression own-name context
// Existing combined syntax/semantic witness counts two EK1702 diagnostics, expected one.
test.todo("Chapter 900: expression own-name context — An `effect` function or producer expression's own [Name](#name) parses with the parameters of its body, `[+Effect]` included, as ECMAScript parses every function expression's name with its body's (`AsyncFunctionExpression : async function BindingIdentifier[~Yield, +Await]opt`).")

// rule-evidence: docs/design/src/900-appendices.md#bc92a0f1645d0fc2 — Chapter 900: reserved expression own names
// Existing combined syntax/semantic witness counts two EK1702 diagnostics, expected one.
test.todo("Chapter 900: reserved expression own names — So `fork` or `join` as that name is `EK1702`, as `(async function await() { })` is a SyntaxError.")
