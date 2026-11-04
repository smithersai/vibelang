// Rule-specific pending obligations from the cov2-vips-a assignment.
// Pending because focused compiler and Effect TypeScript witnesses remain unverified.
// These declarations make no claim that the compiler fails or conforms.
import { test } from "bun:test"

// rule-evidence: docs/design/vips/0004-throw.md#11fb83117da2f309
// VIP-4: foreign throwing code boundaries
test.todo("VIP-4 foreign throwing code boundaries: Code that throws lives in a `.ts` file or a `module` body (VIP-40).")

// rule-evidence: docs/design/vips/0004-throw.md#f80901df86c41272
// VIP-4: dynamic import bridge and argument order
test.todo("VIP-4 dynamic import bridge and argument order: Runtime `import()` uses the same bridge: its own synchronous thrown type is `never`, and source argument expressions keep their separate contracts and order.")

// rule-evidence: docs/design/vips/0004-throw.md#659318f1d726456a
// VIP-4: built in thrown contracts
test.todo("VIP-4 built in thrown contracts: JavaScript's globals and Effect's exports carry no tags, so VibeLang ships annotations for them: `JSON.parse` throws `SyntaxError`, `Math.max` is known not to throw, and `Option.some` throws `never`.")

// rule-evidence: docs/design/vips/0004-throw.md#6c135316bc68e933
// VIP-4: callback rethrows and Promise executors
test.todo("VIP-4 callback rethrows and Promise executors: `setTimeout` does not rethrow, and the `Promise` executor's throws reject the Promise.")

// rule-evidence: docs/design/vips/0004-throw.md#92862263ff1b91b0
// VIP-4: unannotated function type admits never
test.todo("VIP-4 unannotated function type admits never: A function type or interface member with no `@throws` admits only `never`.")

// rule-evidence: docs/design/vips/0004-throw.md#2298363eccc2c782
// VIP-4: dynamic and union call thrown types
test.todo("VIP-4 dynamic and union call thrown types: A call through `any` or `Function` throws `unknown`, and a union of callables throws the union of its alternatives.")

// rule-evidence: docs/design/vips/0004-throw.md#e136627f5c533635
// VIP-4: constructor tracking excludes accessors
test.todo("VIP-4 constructor tracking excludes accessors: `new X()` is tracked; getters and setters are not.")

// rule-evidence: docs/design/vips/0004-throw.md#9a27f23a2d81aacb
// VIP-4: returned decoder owns SchemaError annotation
test.todo("VIP-4 returned decoder owns SchemaError annotation: The annotation amendment above means that returned decoder (found by the round-4 review).*")

// rule-evidence: docs/design/vips/0004-throw.md#0c24f5307c8e0713
// VIP-4: npm and local foreign contract parity
test.todo("VIP-4 npm and local foreign contract parity: An npm package's functions follow exactly the rule a local `.ts` file's do: no `@throws` means it may throw `unknown`, and `@throws` means what it says.")

// rule-evidence: docs/design/vips/0005-try-runs-effects.md#576cf645ccb426e5
// VIP-5: plain handler throw error
test.todo("VIP-5 plain handler throw error: **Amended 2026-10-31: a `throw` in a plain handler is `EK0401`** (VIP-4).")

// rule-evidence: docs/design/vips/0005-try-runs-effects.md#c74c661c2be869bb
// VIP-5: catch effect typed failure quick fix
test.todo("VIP-5 catch effect typed failure quick fix: The quick fix is `catch effect`, which makes the throw a typed failure.")

// rule-evidence: docs/design/vips/0005-try-runs-effects.md#b455bd20a1d066e0
// VIP-5: retired EK0511 warning
test.todo("VIP-5 retired EK0511 warning: The old lint warning `EK0511` retires.")

// rule-evidence: docs/design/vips/0005-try-runs-effects.md#ccfe230c68d4e29b
// VIP-5: specific catch diagnostic triggers
test.todo("VIP-5 specific catch diagnostic triggers: `EK0504` to `EK0510` keep their specific triggers; the old `EK0511` is retired (above).")

// rule-evidence: docs/design/vips/0006-effect-globals.md#b21a02d607ee9e16
// VIP-6: all Effect export globals
test.todo("VIP-6 all Effect export globals: D151's hand-picked list of prefix-free functions, widened here to every `Effect` export.")

// rule-evidence: docs/design/vips/0007-match.md#8679ee3f59945039
// VIP-7: finite union exhaustiveness
test.todo("VIP-7 finite union exhaustiveness: One addition: a `match` with no `default` over a finite union that misses a case is a compile error.")

// rule-evidence: docs/design/vips/0007-match.md#8115e279d032c9ec
// VIP-7: checked subject families
test.todo("VIP-7 checked subject families: **Amended 2026-10-29: what the exhaustiveness check covers.** Literal unions, `boolean`, `data` unions, `error` unions and enums.")

// rule-evidence: docs/design/vips/0007-match.md#062bde9a5b0a71d3
// VIP-7: retained tagged error module guards
test.todo("VIP-7 retained tagged error module guards: **Amended 2026-10-29: the retained tagged-error checks.** The retained checks for Effect's tagged errors are each module's own guard, as D208 compiles `Option.Some` to `Option.isSome`: twelve effect 4.1.1 constructors with a literal `_tag` and a companion `isX` guard (`Cause.TimeoutError` → `Cause.isTimeoutError(s)`, `Schema.SchemaError` → `Schema.isSchemaError(s)`, and the others listed in the spec's Pattern matching chapter).")

// rule-evidence: docs/design/vips/0007-match.md#a31f7267ead610b5
// VIP-7: subject union normalization
test.todo("VIP-7 subject union normalization: **Amended 2026-10-29: which subjects are checked, and which arms cover a case.** The subject's type is normalized into union members (`boolean` to `true | false`, an enum to its members, a `data` type to its variants, `Option` to `None | Some`, `Exit` and `Result` to `Success | Failure`).")

// rule-evidence: docs/design/vips/0007-match.md#9205bca49be48ab7
// VIP-7: unsupported member disables exhaustiveness
test.todo("VIP-7 unsupported member disables exhaustiveness: The check applies when every member is a literal, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance, one of those six cases or a retained Effect error; any other member turns it off.")

// rule-evidence: docs/design/vips/0007-match.md#ec1c2deae4f0a68f
// VIP-7: arrow field and enum binding homes
test.todo("VIP-7 arrow field and enum binding homes: A concise arrow body's binding belongs to the arrow body, and a field initializer's binding to that initializer; an `enum` member initializer has no home, so a binding there is `EK0705`.")

// rule-evidence: docs/design/vips/0007-match.md#a1a0c4dadb1632d0
// VIP-7: unbraced statement binding diagnostics
test.todo("VIP-7 unbraced statement binding diagnostics: **Amended 2026-11-03: unbraced statement bodies (replaces the 2026-10-31 amendment).** The statement body of `if`, `else`, `for`, `for…in`, `for…of`, `for await`, `for concurrent`, `for try`, `while`, `do…while` or a labeled statement, when it is not a Block, cannot be the lexical home of an `is` pattern binding: report `EK0705`, matching TypeScript's `TS1156` for a `let` declaration in that position.")

// rule-evidence: docs/design/vips/0007-match.md#be0cbf2d645b9852
// VIP-7: brace wrapping quick fix
test.todo("VIP-7 brace wrapping quick fix: The quick fix and `vibelang --fix` wrap that statement body in braces.")

// rule-evidence: docs/design/vips/0007-match.md#3db8070047219592
// VIP-7: else if binding home
test.todo("VIP-7 else if binding home: An `if` head belongs to the home that contains the `if` statement; an `else if` head therefore needs braces around the `else` body when it binds.")

// rule-evidence: docs/design/vips/0007-match.md#355f23e0c3b9c352
// VIP-7: nested construct binding homes
test.todo("VIP-7 nested construct binding homes: A binding inside an explicit `do` block, match arm, callable body or loop head keeps its own home.")

// rule-evidence: docs/design/vips/0007-match.md#d3e969162457507a
// VIP-7: within pattern duplicate and or exception
test.todo("VIP-7 within pattern duplicate and or exception: **Amended 2026-10-31: one name per home.** The pinned duplicate-initialization rules and their `or` exception apply within one top-level pattern, as the explainer's scope sentence says.")

// rule-evidence: docs/design/vips/0007-match.md#2cf15433f8b36f4b
// VIP-7: same home redeclarations
test.todo("VIP-7 same home redeclarations: Two top-level patterns that bind one name in the same lexical home are a redeclaration, as two `let` declarations are: `TS2451`, or `TS2300` beside a parameter.")

// rule-evidence: docs/design/vips/0007-match.md#89aefadf08f41f10
// VIP-7: extractor length warning and fixes
test.todo("VIP-7 extractor length warning and fixes: **Amended 2026-10-29: a lint for extractors that can never match.** When a class or fixed pattern's extracted list has a statically known length and an extractor without a rest pattern has a different number of arguments, VibeLang reports a VIP-38 lint warning (`EK0703`), with the quick fixes `when X:` and `when X(let e):`.")

// rule-evidence: docs/design/vips/0007-match.md#74d528eff5f8e7b8
// VIP-7: class extractor warning and fixes
test.todo("VIP-7 class extractor warning and fixes: It is `EK0704`, with the quick fixes `when C:` and, when the arguments bind the constructor's parameter properties, `when C and { p1: let a, p2: let b }:`.")

// rule-evidence: docs/design/vips/0007-match.md#6ddc62088e0f9b97
// VIP-7: literal string tagged object exhaustiveness
test.todo("VIP-7 literal string tagged object exhaustiveness: **Amended 2026-10-29: exhaustiveness for unions of objects with a literal `_tag`.** A subject member whose type has a `_tag` property of exactly one string literal type (an object type, an interface or a class instance type) is a checked member, so `EK4701` applies when every member is a checked kind; any member without a literal `_tag` still turns the check off.")

// rule-evidence: docs/design/vips/0007-match.md#097bf17eb9302db5
// VIP-7: only tag is a discriminant
test.todo("VIP-7 only tag is a discriminant: Only `_tag` is a discriminant.")

// rule-evidence: docs/design/vips/0007-match.md#e4530996b2ceb59f
// VIP-7: all literal tag kinds
test.todo("VIP-7 all literal tag kinds: A member is tagged when its `_tag` is a literal type: a string, number, bigint, boolean, enum, `null` or `undefined` literal, a `unique symbol`, or a union of those.")

// rule-evidence: docs/design/vips/0007-match.md#30582fa5f6fb5f0d
// VIP-7: optional tag includes undefined
test.todo("VIP-7 optional tag includes undefined: Each literal is a case, and an optional `_tag` has the case `undefined`, so `{ _tag?: \"A\" } | { _tag: \"B\" }` is checked and the absent tag is left, as `tsc` leaves it.")

// rule-evidence: docs/design/vips/0007-match.md#1382860bdf564804
// VIP-7: nonliteral tag disables check
test.todo("VIP-7 nonliteral tag disables check: Any other `_tag` type turns the check off.")

// rule-evidence: docs/design/vips/0007-match.md#688a052a286b9642
// VIP-7: shared tag required property coverage
test.todo("VIP-7 shared tag required property coverage: Members that share a tag are covered one at a time: an object pattern covers a member only when every other property it tests is required on that member, as `\"x\" in s` narrows.")

// rule-evidence: docs/design/vips/0007-match.md#3f108270c1a50ebb
// VIP-7: eager parameter binding invariants
test.todo("VIP-7 eager parameter binding invariants: Preserve eager once-only initialization, parameter/body scope separation, `length`, TDZ, closures and exception boundaries; no generic move-to-body repair is supplied.")

// rule-evidence: docs/design/vips/0007-match.md#eb94a095e119a104
// VIP-7: concurrency limit enclosing home
test.todo("VIP-7 concurrency limit enclosing home: **Amended 2026-10-31: limit and catch-parameter homes.** A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop, because the limit runs before the head environment exists.")

// rule-evidence: docs/design/vips/0007-match.md#78b48387f4b9a698
// VIP-7: catch parameter binding rejection
test.todo("VIP-7 catch parameter binding rejection: A binding in catch-clause parameter initialization is `EK0705`, as for a formal parameter: that environment is distinct from the catch Block, and no reconciliation gives it a binding home.")

// rule-evidence: docs/design/vips/0007-match.md#e3971bc6aa7d844c
// VIP-7: bare fixed patterns cover cases
test.todo("VIP-7 bare fixed patterns cover cases: **Amended 2026-10-31: a bare fixed pattern covers its case.** `when Option.Some:` covers `Some`, as `when Option.Some(let v):` does, and likewise bare `Option.None`, `Exit.Success`, `Exit.Failure`, `Result.Success` and `Result.Failure`: the extracted-length rule applies only to a written argument list, and no list is not an empty list.")

// rule-evidence: docs/design/vips/0007-match.md#e960917159bb1595
// VIP-7: lexical and parameter duplicate diagnostics
test.todo("VIP-7 lexical and parameter duplicate diagnostics: Two top-level patterns that bind one name in the same lexical home are a redeclaration, as two `let` declarations are, and report what such a `let` reports: `TS2451` beside another lexical declaration, `TS2300` beside a parameter.")

// rule-evidence: docs/design/vips/0007-match.md#dd17190e2e5680df
// VIP-7: all unbraced statement binding sites
test.todo("VIP-7 all unbraced statement binding sites: The statement body of `if`, `else`, `for`, `for…in`, `for…of`, `for await`, `for concurrent`, `for try`, `while`, `do…while` or a labeled statement, when it is not a Block, cannot be the lexical home of an `is` pattern binding: report `EK0705`, matching TypeScript's `TS1156` for a `let` declaration in that position.")
