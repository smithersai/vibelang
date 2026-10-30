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
| Regular-expression patterns | `/re/` as a pattern in an example | a `RegExp` value as a variable pattern, through `RegExp.prototype[Symbol.customMatcher]` | both: a literal `/re/` is a pattern, and a `RegExp` value matches through the specification's matcher |
| `async match` | a possible future enhancement | absent | the explainer's sketch: `async match (s) { ... }` is a `Promise` of the arm's value, and its arms may `await` |
| A custom matcher's arguments | the subject and `{ matchType: "boolean" }` or `{ matchType: "extractor" }` | the subject, the string `"boolean"` or `"list"`, and the receiver | the explainer's, which VibeLang already passed: the subject and `{ matchType }` |
| Built-in custom matchers | `Function.prototype`, primitives, `RegExp.prototype` | also `Array`, `Error`, `Map`, `Set`, `Date`, `Promise` and the other built-in constructors | the specification's for `RegExp.prototype`, emulated without changing any built-in object. Built-in constructors test `Array.isArray(subject)` for `Array` and `subject instanceof C` for the others, since compiled JavaScript can't read their internal slots (decided detail 67a); `String`, `Number`, `Boolean`, `BigInt` and `Symbol` test the primitive or `instanceof` its boxed object (decided detail 87). A cross-realm built-in other than an array fails. The inherited `Function.prototype` matcher for other classes is replaced by `subject instanceof C` (decided detail 67): its `[[ConstructedBy]]` slot can only be recorded by an engine, so an object whose prototype changed after construction doesn't match and `Object.create(C.prototype)` does |

## What VibeLang adds or keeps

- A `match` without `default` over a finite union that misses a case is EK4701 at compile time. The check reports; it never changes what runs, and an unmatched value throws the proposal's `TypeError`.
- The runtime defines `Symbol.customMatcher` when the engine lacks it.
- An `error` class has a static `[Symbol.customMatcher]` that tests the subject's `_tag`, so `when NotFound:` matches a `NotFound` from another copy of its package.
- Effect's `Option`, `Exit` and `Result`, and Effect's tagged errors (VIP-7), keep their fixed compiled checks (D208) until Effect ships custom matchers; the proposal for Effect is drafted in [`docs/upstream/effect-custom-matchers.md`](../../../upstream/effect-custom-matchers.md).
