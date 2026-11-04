// Assigned chapter 004 coverage obligations; pending is intentional.
// Conformance has not been verified: preserve the full required assertion for promotion.
import { test } from "bun:test"

// rule-evidence: docs/design/src/004-match.md#cbadc62d2ad52ddf
// Chapter 004: literal null undefined enum coverage
test.todo("literal null undefined enum coverage — docs/design/src/004-match.md#cbadc62d2ad52ddf — A literal, `null`, `undefined` or enum-member pattern covers that member.")

// rule-evidence: docs/design/src/004-match.md#47665d93a431596f
// Chapter 004: fixed pattern exhaustive binding arity
test.todo("fixed pattern exhaustive binding arity — docs/design/src/004-match.md#47665d93a431596f — A fixed pattern (`Option.Some`, `Option.None`, `Exit.Success`, `Exit.Failure`, `Result.Success`, `Result.Failure`) or a retained error covers its case when it is bare, or when its argument list has the required length and every argument pattern is a bare `let` or `const` binding.")

// rule-evidence: docs/design/src/004-match.md#d70e477dcf8a61b7
// Chapter 004: bare versus empty extractor coverage
test.todo("bare versus empty extractor coverage — docs/design/src/004-match.md#d70e477dcf8a61b7 — A bare pattern has no argument list, which is not an empty list: `when Option.Some:` and `when Option.Some(let v):` cover `Some`; `when Option.Some():` and `when Option.Some(1):` do not.")

// rule-evidence: docs/design/src/004-match.md#30e33b47996ef0ee
// Chapter 004: finite generic domain and open no-match
test.todo("finite generic domain and open no-match — docs/design/src/004-match.md#30e33b47996ef0ee — A finite generic constraint is checked for every admitted instantiation; an open parameter retains the ordinary no-match `TypeError`:")

// rule-evidence: docs/design/src/004-match.md#854ac0ad14057eba
// Chapter 004: async match primary and newline restriction
test.todo("async match primary and newline restriction — docs/design/src/004-match.md#854ac0ad14057eba — [AsyncMatchExpression](900-appendices.md#asyncmatchexpression) is a primary expression; no line terminator may separate `async` and `match`.")

// rule-evidence: docs/design/src/004-match.md#daa89d17f3537b64
// Chapter 004: async subject tests and arm execution
test.todo("async subject tests and arm execution — docs/design/src/004-match.md#daa89d17f3537b64 — `async match (s) { … }` has the async-function behavior `(async () => match (s) { … })()`: subject evaluation, tests and the selected arm run inside the async function.")

// rule-evidence: docs/design/src/004-match.md#7154fa46f54da69c
// Chapter 004: async await and rejection propagation
test.todo("async await and rejection propagation — docs/design/src/004-match.md#7154fa46f54da69c — `await` is allowed there; a thrown exception, including the no-match `TypeError`, rejects the resulting `Promise`.")

// rule-evidence: docs/design/src/004-match.md#7e6fe847d2c61b61
// Chapter 004: async match grammar contexts
test.todo("async match grammar contexts — docs/design/src/004-match.md#7e6fe847d2c61b61 — The explicit [VIP-7 reconciliation](../vips/tc39-pattern-matching/README.md#reconciliations-with-the-drafts-text) gives the subject, tests and arms `[~Yield, +Await, ~Return, ~Effect]` contexts, even inside a plain function.")

// rule-evidence: docs/design/src/004-match.md#5705229d23026079
// Chapter 004: signed zero does not cover both zeros
test.todo("signed zero does not cover both zeros — docs/design/src/004-match.md#5705229d23026079 — A signed zero pattern, `+0` or `-0`, covers no case of TypeScript's literal type `0`, because that type admits both zeros.")

// rule-evidence: docs/design/src/004-match.md#a3cb5536212d6352
// Chapter 004: inherited matcher uses instanceof
test.todo("inherited matcher uses instanceof — docs/design/src/004-match.md#a3cb5536212d6352 — A static matcher inherited from a superclass is not an own matcher: for `class B extends A {}`, `when B:` tests `s instanceof B`.")

// rule-evidence: docs/design/src/004-match.md#3d80eda342f5e0fc
// Chapter 004: error and schema error tag matcher
test.todo("error and schema error tag matcher — docs/design/src/004-match.md#3d80eda342f5e0fc — An `error` class ([Failures](003-failures.md#error-declarations)), including a `schema error`, gets a matcher that tests `_tag`.")

// rule-evidence: docs/design/src/004-match.md#0843ffd98a584991
// Chapter 004: error matcher singleton subject identity
test.todo("error matcher singleton subject identity — docs/design/src/004-match.md#0843ffd98a584991 — It returns `[subject]` on a match and `false` otherwise; `when NotFound(let e):` binds that subject.")

// rule-evidence: docs/design/src/004-match.md#2e66abda6c942f6a
// Chapter 004: zero-argument error extractor never matches
test.todo("zero-argument error extractor never matches — docs/design/src/004-match.md#2e66abda6c942f6a — `when NotFound():` never matches: the matcher returns one element, but the extractor has zero argument patterns.")

// rule-evidence: docs/design/src/004-match.md#abd621a1b1fe8f7c
// Chapter 004: bare error recognition
test.todo("bare error recognition — docs/design/src/004-match.md#abd621a1b1fe8f7c — Write `when NotFound:` for a bare test.")

// rule-evidence: docs/design/src/004-match.md#1ff501368daa6b54
// Chapter 004: cross-package error recognition
test.todo("cross-package error recognition — docs/design/src/004-match.md#1ff501368daa6b54 — Thus `when NotFound:` matches across copies of the same package.")

// rule-evidence: docs/design/src/004-match.md#676c26f0b209359c
// Chapter 004: data variant has no custom matcher
test.todo("data variant has no custom matcher — docs/design/src/004-match.md#676c26f0b209359c — `data` variants get no custom matchers.")

// rule-evidence: docs/design/src/004-match.md#dd7795df35d35949
// Chapter 004: data object pattern payload extraction
test.todo("data object pattern payload extraction — docs/design/src/004-match.md#dd7795df35d35949 — Match them with object patterns on `_tag`: `when { _tag: \"Sent\", let tracking }: …` ([Data](006-data.md#data-declarations)).")

// rule-evidence: docs/design/src/004-match.md#9c04d2e63a8cf32c
// Chapter 004: generated matcher declaration inventory
test.todo("generated matcher declaration inventory — docs/design/src/004-match.md#9c04d2e63a8cf32c — Only `error` and `schema error` declarations, and the retained Effect checks, have their own matcher.")

// rule-evidence: docs/design/src/004-match.md#10930b741e9327c6
// Chapter 004: nonmatcher declarations EK0702
test.todo("nonmatcher declarations EK0702 — docs/design/src/004-match.md#10930b741e9327c6 — A class pattern whose expression resolves to a `data` declaration or variant constructor, a `schema` declaration or a directly constructed `Context.Reference` is `EK0702`: under the draft such a function would be called with the subject and match almost anything.")

// rule-evidence: docs/design/src/004-match.md#f952844e774f9e70
// Chapter 004: variant and schema quick fixes
test.todo("variant and schema quick fixes — docs/design/src/004-match.md#f952844e774f9e70 — The quick fix for a variant writes `when { _tag: \"Sent\" }:`; for a schema, test `Schema.is(Address)(x)` in a guard.")

// rule-evidence: docs/design/src/004-match.md#57c0454695b5cd0a
// Chapter 004: service matcher EK3004
test.todo("service matcher EK3004 — docs/design/src/004-match.md#57c0454695b5cd0a — Every `service` declaration, with or without `defaultValue`, reports `EK3004` instead ([Services](005-services.md#static-rules)).")

// rule-evidence: docs/design/src/004-match.md#3a5159245d55e085
// Chapter 004: aliased fixed pattern binding
test.todo("aliased fixed pattern binding — docs/design/src/004-match.md#3a5159245d55e085 — Recognition follows the resolved module binding, including aliases: `import * as O from \"effect/Option\"` permits `when O.Some(let v):`.")

// rule-evidence: docs/design/src/004-match.md#bad93a16e3595c9d
// Chapter 004: shadowed Option ordinary matcher lookup
test.todo("shadowed Option ordinary matcher lookup — docs/design/src/004-match.md#bad93a16e3595c9d — A local `Option` instead uses TC39's matcher lookup; spelling alone never selects an intrinsic.")

// rule-evidence: docs/design/src/004-match.md#94369f1a42c83988
// Chapter 004: retained guard cannot be replaced
test.todo("retained guard cannot be replaced — docs/design/src/004-match.md#94369f1a42c83988 — Neither `instanceof`, a universal `_tag` test nor the subject’s static type replaces the guard.")

// rule-evidence: docs/design/src/004-match.md#caa30c46311be281
// Chapter 004: builtin Array and instanceof recognition
test.todo("builtin Array and instanceof recognition — docs/design/src/004-match.md#caa30c46311be281 — Built-in constructor patterns use `Array.isArray(subject)` for `Array`, and `subject instanceof C` for every other built-in, including native errors, `AggregateError`, `Date`, `RegExp`, collections, `Promise`, typed arrays and `ArrayBuffer`.")

// rule-evidence: docs/design/src/004-match.md#4bffb2729dcd487c
// Chapter 004: primitive boxed extraction
test.todo("primitive boxed extraction — docs/design/src/004-match.md#4bffb2729dcd487c — `String`, `Number`, `Boolean`, `BigInt` and `Symbol` test the primitive or its boxed object, `typeof s === \"string\" || s instanceof String` and so on, and extract `[s]` for a primitive and `[s.valueOf()]` for a boxed object.")

// rule-evidence: docs/design/src/004-match.md#11fcb5ac83450867
// Chapter 004: foreign ordinary class instanceof dispatch
test.todo("foreign ordinary class instanceof dispatch — docs/design/src/004-match.md#11fcb5ac83450867 — Ordinary classes without an explicit matcher, including classes imported from untouched `.ts` or `.js`, instead test `subject instanceof C`, then extract as the draft specifies.")

// rule-evidence: docs/design/src/004-match.md#5e9539a1a770b684
// Chapter 004: ordinary extractor runtime TypeError
test.todo("ordinary extractor runtime TypeError — docs/design/src/004-match.md#5e9539a1a770b684 — For an ordinary class without an own matcher, the draft’s successful test returns `true`, not `[s]`: using it as an extractor throws `TypeError`, rather than binding an instance.")

// rule-evidence: docs/design/src/004-match.md#7e2f199f76f789db
// Chapter 004: Array typed-array Map Set extraction
test.todo("Array typed-array Map Set extraction — docs/design/src/004-match.md#7e2f199f76f789db — Built-in adapters retain their own extraction rules: `Array` and typed arrays return the subject as the list; `Map` and `Set` return `[subject]`.")

// rule-evidence: docs/design/src/004-match.md#3c9764a665567767
// Chapter 004: static-signature dispatch receiver preservation
test.todo("static-signature dispatch receiver preservation — docs/design/src/004-match.md#3c9764a665567767 — After own matchers, fixed patterns, built-ins and declaration diagnostics, dispatch uses the callee’s static signatures: a construct signature selects `instanceof`, including ES5 constructors declared as constructable; call signatures only select `C(subject, { matchType })`, preserving a member receiver.")

// rule-evidence: docs/design/src/004-match.md#59bd25c991f8b61e
// Chapter 004: call-only predicate and iterable result contracts
test.todo("call-only predicate and iterable result contracts — docs/design/src/004-match.md#59bd25c991f8b61e — A bare call-only pattern requires a return type assignable to `boolean`; an extractor requires `Iterable<unknown> | false`.")

// rule-evidence: docs/design/src/004-match.md#673faa003e9abfa0
// Chapter 004: invalid signature EK0702 and guard quick fix
test.todo("invalid signature EK0702 and guard quick fix — docs/design/src/004-match.md#673faa003e9abfa0 — Other return types, and callees with neither signature (`any`, `unknown`, `Function`, non-callable objects), are `EK0702`; quick fix: test the call in a guard.")

// rule-evidence: docs/design/src/004-match.md#7cebe0ba71ff3a4f
// Chapter 004: Function EK0107 guard repair
test.todo("Function EK0107 guard repair — docs/design/src/004-match.md#7cebe0ba71ff3a4f — The global `Function` still reports `EK0107`; use a `typeof` guard.")

// rule-evidence: docs/design/src/004-match.md#3b168055d2037a98
// Chapter 004: ordinary class extractor EK0704 all arities
test.todo("ordinary class extractor EK0704 all arities — docs/design/src/004-match.md#3b168055d2037a98 — An ordinary-class extractor without an own matcher is `EK0704`, with any argument count, including `()`.")

// rule-evidence: docs/design/src/004-match.md#a13137dc3992d053
// Chapter 004: ordinary class extractor quick fixes
test.todo("ordinary class extractor quick fixes — docs/design/src/004-match.md#a13137dc3992d053 — Quick fixes: `when C:`; or, when the arguments bind the constructor’s parameter properties, `when C and { p1: let a, p2: let b }:`.")

// rule-evidence: docs/design/src/004-match.md#00bfbbbb7fc3d628
// Chapter 004: any-erased constructor extractor TypeError
test.todo("any-erased constructor extractor TypeError — docs/design/src/004-match.md#00bfbbbb7fc3d628 — A bypass through `any` retains the draft’s run-time `TypeError` on recognition.")

// rule-evidence: docs/design/src/004-match.md#1fa4986a36e143b4
// Chapter 004: None optional argument no arity warning
test.todo("None optional argument no arity warning — docs/design/src/004-match.md#1fa4986a36e143b4 — For example, `Option.None(1?)` admits its empty extracted list and is not warned.")

// rule-evidence: docs/design/src/004-match.md#326b9d72a14eea33
// Chapter 004: fixed subject evaluation once
test.todo("fixed subject evaluation once — docs/design/src/004-match.md#326b9d72a14eea33 — `s` is the subject, evaluated once.")

// rule-evidence: docs/design/src/004-match.md#ceec72c3421f5081
// Chapter 004: fixed extractor list interval and subpatterns
test.todo("fixed extractor list interval and subpatterns — docs/design/src/004-match.md#ceec72c3421f5081 — An extractor matches the listed array against its argument patterns by the snapshot's list rules: without rest, the extracted length must fit the required-to-total position interval and every present sub-pattern must match.")

// rule-evidence: docs/design/src/004-match.md#48e6817ded20eda2
// Chapter 004: zero and optional extraction lengths
test.todo("zero and optional extraction lengths — docs/design/src/004-match.md#48e6817ded20eda2 — Zero arguments match only `[]`; absent optionals consume zero positions, so `Option.None(1?)` also matches.")

// rule-evidence: docs/design/src/004-match.md#4ea2f7f030ac2abd
// Chapter 004: arity mismatch fails with EK0703
test.todo("arity mismatch fails with EK0703 — docs/design/src/004-match.md#4ea2f7f030ac2abd — An arity mismatch is a failed match (`EK0703` warns).")
