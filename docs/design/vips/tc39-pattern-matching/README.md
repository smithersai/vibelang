# TC39 pattern matching: the pinned snapshot

VIP-7 makes VibeLang's `match` and `is` the TC39 pattern-matching proposal, pinned to this dated snapshot. VibeLang moves to a newer snapshot deliberately, by replacing these files in a commit that says what changed, never automatically.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/tc39/proposal-pattern-matching` |
| Commit | `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e` ("format spec") |
| Commit date | 2025-10-03 |
| Fetched | 2026-10-29 |
| Stage | 1 |
| License | MIT, in [`LICENSE`](LICENSE) |

| File | Upstream file |
| --- | --- |
| [`explainer.md`](explainer.md) | `README.md`, the explainer |
| [`spec.emu`](spec.emu) | `spec.emu`, the draft specification text |

## Where the two upstream files disagree

The explainer and the draft specification differ in a few places. VibeLang follows the one named here.

| Topic | Explainer | Draft specification | VibeLang |
| --- | --- | --- | --- |
| Arm syntax | `when P: value;` | `P: value;` | `when P: value;`, as VIP-7 writes it |
| Relational patterns (`<`, `>`, `<=`, `>=`, `==`, `!=`, `===`, `!==`, `instanceof`, `in`) | a possible future enhancement | `RelationalPattern` | the specification's grammar and semantics |
| Regular-expression patterns | `/re/` as a pattern in an example | a `RegExp` value as a variable pattern, through `RegExp.prototype[Symbol.customMatcher]` | one `RegularExpressionPattern` alternative admits a bare literal or its `(MatchList)` extractor suffix, with the same nullable-list extraction as a named `RegExp` value |
| `async match` | a possible future enhancement | absent | the explainer's sketch: `async match (s) { ... }` is a `Promise` of the arm's value, and its arms may `await` |
| Primitive template patterns | ordinary interpolation described | `NoSubstitutionTemplate`; structural interpolation left for future work | only a no-substitution template is a primitive pattern; use an ordinary interpolated template in a guard for dynamic comparison |
| A custom matcher's arguments | the subject and `{ matchType: "boolean" }` or `{ matchType: "extractor" }` | the subject, the string `"boolean"` or `"list"`, and the receiver | the explainer's, which VibeLang already passed: the subject and `{ matchType }` |
| Built-in custom matchers | `Function.prototype`, primitives, `RegExp.prototype` | also `Array`, `Error`, `Map`, `Set`, `Date`, `Promise` and the other built-in constructors | the specification's for `RegExp.prototype`, emulated without changing any built-in object. Built-in constructors test `Array.isArray(subject)` for `Array` and `subject instanceof C` for the others, since compiled JavaScript can't read their internal slots (decided detail 67a); `String`, `Number`, `Boolean`, `BigInt` and `Symbol` test the primitive or `instanceof` its boxed object (decided detail 87). A cross-realm built-in other than an array fails. The inherited `Function.prototype` matcher for other classes is replaced by `subject instanceof C` (decided detail 67): its `[[ConstructedBy]]` slot can only be recorded by an engine, so an object whose prototype changed after construction doesn't match and `Object.create(C.prototype)` does |

## Reconciliations with the draft's text

The draft text stays as vendored. VibeLang reads these steps as follows.

| Step | Draft | VibeLang | Why |
| --- | --- | --- | --- |
| `FinishMatch`, its error list | "If _matchCompletion_ is an abrupt completion, append _matchCompletion_.[[Value]] to _errors_." | "… is a throw completion …". A `return`, `break` or `continue` closes the cached iterators and goes on; an error from closing replaces it | Read literally, `return 7` becomes `throw 7`. The draft's editor's notes show `do { …; return w * w; }` in a clause and describe a `continue` that survives unless closing fails. A generator's `return()` at a `yield` in an arm reaches the same step without `do`. `for…of` is the precedent: ECMA-262 IteratorClose keeps the completion and lets a closing error replace it |
| Template equality | unguarded `SameValueNonNumber` on any subject | general `SameValueZero`, as for a literal | equal strings match; non-strings fail without coercion or an abstract-operation domain violation |
| Object-pattern identifier keys | disputed early error rejects a `PropertyName` coverable by `BindingIdentifier` | that specific early error is not adopted, for bare keys or keys before `:` | VIP-16 requires presence keys and `_tag:`; unrelated errors, including the separate `__proto__` restriction, remain |
| Array-pattern grammar | optional `MatchList` although that nonterminal is nullable | one required nullable `MatchList`; empty and nonempty patterns share cached Iterator Records | `[]` has one derivation and tests an empty iterable, without the invalid subject-as-record path |
| Contextual `not` ambiguity | both prefix negation and an identifier-rooted member/extractor can parse | choose prefix negation whenever both parse, then apply early errors; never consult local bindings | syntax determines behavior; `helpers.not(...)` remains an ordinary extractor |
| Failed `or` bindings | declaration evaluation has no failed-alternative replacement exception | same-keyword alternatives share a cell; a later alternative can replace initialization from a failed earlier alternative of that `or` | the explainer requires replacement and shared closure identity; unrelated bindings and normal `const` assignment rules stay intact |
| Lexical `is` in loop heads | nearest-block prose does not determine repeated initialization | the explainer's loop-head scope with fresh cells per full `while`/`do…while` condition, shared with its following body; initial do-body cells remain uninitialized | fresh iteration closure identity, TDZ, shadowing and short-circuit behavior, without reinitializing one `const` cell |
| Iterator inputs and registry | extractor returns its iterable; finishing reads Set entries as records with user properties | list matching and cleanup share private cached Iterator Records, with wrapper entries read directly and empty slots skipped | iterator-record and ECMAScript SetData contracts; no user `Value` or `IteratorsToClose` reads |
| Primitive array subjects | Object-only cached `Get` | cached `GetV` semantics, preserving the original receiver; nullish/missing/noncallable iterator cases fail the pattern | primitive strings are iterable; ordinary protocol throws remain throws |
| Elision cardinality | advances by one per `Elision` node | consumes the full comma width for leading, internal and trailing elisions | each elision position is required and advances the actual list index |
| Absent optional elements | counts a missing element as one | consumes zero, retains done/index state, and skips its sub-pattern/binding initialization | repeated absence preserves sequential cache invariants; present `undefined` still gets tested |
| Expression values | guards Boolean-convert References; selected expressions return References | guard and selected/default expressions supply ordinary `GetValue` results at their source position | getters and TDZ errors precede Boolean conversion or cleanup |
| Object property order | recursive property list tests its last property first | left-to-right source order, with rest afterward | the explainer's object-pattern order |
| Object rest and caching | `CopyDataProperties` | retain ordinary own-key/enumerability/Get behavior outside the match cache | rest may re-read a previously cached getter; only cached pattern reads have the once-only guarantee |
| Inclusive relations | swapped arguments invert `<=` and `>=` | ordinary admitted-subject `<=` and `>=`, including coercion order and unordered results | inclusive and strict relations keep their ordinary ECMAScript directions |
| `is`, its evaluation | "Let _matchCompletion_ be ? MatchPatternMatches of …", then a `~not-matched~` conversion | `Completion(MatchPatternMatches(…))`, kept as it is and passed to `FinishMatch` | `?` skips the closing step that the next line performs, and `MatchPatternMatches` gives a Boolean, not `~not-matched~` |
| `async match`, its grammar contexts | a Promise-producing sketch; the vendored specification has no formal `async match` production | the subject, tests and arms use `[~Yield, +Await, ~Return, ~Effect]`; `return` and outward `break`/`continue` are syntax errors; nested source callables reset their contexts normally | An explicit VIP-7 reconciliation completes the sketch with a self-contained source grammar |
| `while`/`do…while` lexical `is` cells | the explainer proposes loop-head/per-iteration scopes and an initial `do` TDZ | every complete condition starts fresh cells shared with its following body; initial-`do` closures keep their original TDZ cells | This states the source lifetime and closure identity without prescribing a lowering |

## What VibeLang adds or keeps

- A `match` without `default` over a finite union that misses a case is EK4701 at compile time. The check reports; it never changes what runs, and an unmatched value throws the proposal's `TypeError`.
- The runtime defines `Symbol.customMatcher` when the engine lacks it.
- An `error` class has a static `[Symbol.customMatcher]` that tests the subject's `_tag`, so `when NotFound:` matches a `NotFound` from another copy of its package.
- Effect's `Option`, `Exit` and `Result`, and Effect's tagged errors (VIP-7), keep their fixed compiled checks (D208) until Effect ships custom matchers; the proposal for Effect is drafted in [`docs/upstream/effect-custom-matchers.md`](../../../upstream/effect-custom-matchers.md).
