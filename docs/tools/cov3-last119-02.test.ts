// Complete compiler/native verification deferred for these individual obligations.
// Pending does not assert that the compiler fails the rule.
import { test } from "bun:test"

// rule-evidence: docs/design/src/900-appendices.md#5010e0fc10e971dd — Chapter 900: optional tuple indexed undefined
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional tuple indexed undefined — This allows omission and contributes `undefined` on indexed access, as in TypeScript; the `?` is not a JSDoc suffix inside a slot.")

// rule-evidence: docs/design/src/900-appendices.md#50989a14cfbfa550 — Chapter 900: stray postfix question rejection
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: stray postfix question rejection — A stray postfix `?` outside an independently admitted TypeScript punctuation context remains invalid.")

// rule-evidence: docs/design/src/900-appendices.md#2ecdaee836ac6ec7 — Chapter 900: generic function requirement grouping
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: generic function requirement grouping — A generic function requirement needs parentheses, `A!!(<T>() => T)`.")

// rule-evidence: docs/design/src/900-appendices.md#a3f80d0b305c45a7 — Chapter 900: tuple requirement versus element access
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: tuple requirement versus element access — A leading `[` does start a tuple type, so `x as A!![0]` consumes `[0]` as `R`; `(x as A!!)[0]` requests a later element access, subject to ordinary type checking.")

// rule-evidence: docs/design/src/900-appendices.md#7ed43412b9ef643b — Chapter 900: assertion chain slot boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: assertion chain slot boundary — In an expression, `x as A!! as B` and `x as A!! satisfies B` retain the ordinary chained assertion or check when consuming the keyword as `R` would strand `B`.")

// rule-evidence: docs/design/src/900-appendices.md#c33160ced9f37d44 — Chapter 900: contextual aliases in requirement slots
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: contextual aliases in requirement slots — This is not a token ban: TypeScript allows type aliases named `as` and `satisfies`, so a pure type `A!!as`, a required or parenthesized slot using those aliases, and `x as A!!as satisfies unknown` retain their valid present-`R` parse.")

// rule-evidence: docs/design/src/900-appendices.md#9e4a2fd9df549e43 — Chapter 900: complete parse present requirement preference
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: complete parse present requirement preference — When both complete source parses survive, prefer the present `R`, with no symbol lookup.")

// rule-evidence: docs/design/src/900-appendices.md#885afaae490b2372 — Chapter 900: ASI requirement choice
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: ASI requirement choice — With `x as A!!as` at the end of a line and `B` on the next, both parses complete: the present `R` ends the statement by ASI, leaving `B` a second statement, and the chained assertion continues across the line break, so the present `R` wins.")

// rule-evidence: docs/design/src/900-appendices.md#72f43e9eca4bd9d1 — Chapter 900: same-line assertion completion
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: same-line assertion completion — On one line, `x as A!! as B` has no semicolon to insert after `as`, so only the chained assertion completes.")

// rule-evidence: docs/design/src/900-appendices.md#a7359fe78e4fa3b9 — Chapter 900: slot boundary runtime witness
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: slot boundary runtime witness — `slotBoundaryWitness()` succeeds with `[0, 0, true]`.")

// rule-evidence: docs/design/src/900-appendices.md#e35796182b8d021f — Chapter 900: catch arrow pipe greediness
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: catch arrow pipe greediness — The `|>` then belongs to the arrow's body, as `?` does above: `a catch () => b |> % + 1` is `a catch (() => (b |> % + 1))`, and `x |> % catch () => y |> % + 1` is `x |> (% catch (() => (y |> % + 1)))`.")

// rule-evidence: docs/design/src/900-appendices.md#8e0508981e793aa4 — Chapter 900: closed catch handler pipe recovery
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: closed catch handler pipe recovery — Parentheses around the handler or the whole `catch` expression, a `NonArrowHandler` and a block-bodied arrow close the handler, so a following `|>` pipes the recovered value.")

// rule-evidence: docs/design/src/900-appendices.md#05952a6317f3b0df — Chapter 900: parenthesized and branched pipe controls
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: parenthesized and branched pipe controls — A parenthesized pipe is a `ParenthesizedExpression`, and a pipe in either branch is an `AssignmentExpression`, so neither is affected:")

// rule-evidence: docs/design/src/900-appendices.md#8f82286b6ace08e2 — Chapter 900: malformed catch single diagnostic
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: malformed catch single diagnostic — Recovery for a parameter list followed directly by a block after `catch`, as in `try x catch (e) { B }`, reports `EK0509` without an additional `EK0505` for that same malformed handler.")

// rule-evidence: docs/design/src/900-appendices.md#70747eafb3e5676c — Chapter 900: Effect block return yield and jump boundaries
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect block return yield and jump boundaries — The braces hold a function body, as `(effect () => { … })()` does: `return` ends the block's Effect with a value, and `yield` is `EK2104`, and a `break` or `continue` whose target is outside the block is `EK0202`.")

// rule-evidence: docs/design/src/900-appendices.md#b2708591e09fa400 — Chapter 900: top-level Effect block
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: top-level Effect block — So `const p = effect { return 1 }` parses at module top level.")

// rule-evidence: docs/design/src/900-appendices.md#257b4dc751da2877 — Chapter 900: async Effect block repair
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: async Effect block repair — The block quick fix is to remove `async`, retaining `effect { B }`; `async { B }` is not admitted.")

// rule-evidence: docs/design/src/900-appendices.md#8c64af609dfefe08 — Chapter 900: Effect loop declaration bindings
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: Effect loop declaration bindings — `ForDeclaration` is ECMAScript's, `LetOrConst ForBinding`: a `const` or `let` declaration, destructuring included (VIP-19 and VIP-20, amended).")

// rule-evidence: docs/design/src/900-appendices.md#688469f012e91815 — Chapter 900: provide comma newline recovery
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide comma newline recovery — A head violating only the comma-adjacent `LineTerminator` restrictions remains a recovered `provide` statement and receives `EK1202` on either side of a provider-list separator; the outside-Effect `EK1201` rule still applies.")

// rule-evidence: docs/design/src/900-appendices.md#7d0301efe65a6790 — Chapter 900: provide recovery grammar limits
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide recovery grammar limits — This recovery does not relax the ordinary provider grammar, the restriction after `provide` or the final provider's same-line body-opening `{`.")

// rule-evidence: docs/design/src/900-appendices.md#bb45df023b072b5d — Chapter 900: provide ordinary expression controls
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide ordinary expression controls — Ordinary calls, element access, subtraction and expression positions after `return` retain their existing readings.")

// rule-evidence: docs/design/src/900-appendices.md#9dfc54fb3f6dea75 — Chapter 900: provide line terminator boundaries
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: provide line terminator boundaries — No line break may come between `provide` and the first provider, on either side of a comma, or between the last provider and the block's `{` (VIP-12: \"its providers and block must be on one line\").")

// rule-evidence: docs/design/src/900-appendices.md#75a861c471215f3b — Chapter 900: service default initializer context
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: service default initializer context — A `DefaultMember` initializer uses the source class-field context: the enclosing Effect execution and `fork`/`join` reservation reset.")

// rule-evidence: docs/design/src/900-appendices.md#0587739b6d0b5073 — Chapter 900: service default execution boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: service default execution boundary — An explicit Effect run there is outside effect code (`try e` is `EK0501`); an ordinary identifier call such as `join(...)` keeps its ordinary meaning.")

// rule-evidence: docs/design/src/900-appendices.md#0139dc9c7612d40b — Chapter 900: service default native boundaries
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: service default native boundaries — Native `await`/`yield`, nested callable boundaries and eager initializer/throw checks retain their native source rules.")

// rule-evidence: docs/design/src/900-appendices.md#5c62640472bb75fa — Chapter 900: optional error body termination
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: optional error body termination — The body of an `error` or `schema error` declaration is optional, as the body of TypeScript's `declare module \"m\"` is: when the next token after the name is `{`, however many line breaks precede it, or `<`, `extends` or `implements` on the name's line, the declaration continues; otherwise it ends as a TypeScript statement does, at `;`, a line break, `}` or the end of the file.")

// rule-evidence: docs/design/src/900-appendices.md#f1fc5ba0f5e76e09 — Chapter 900: bodyless error declaration ASI
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: bodyless error declaration ASI — So `error Timeout` then `const t = 1` on the next line is a declaration with no fields, then a `const`; `error Timeout` then `<T>(x: T) => x` is a declaration, then a generic arrow statement.")

// rule-evidence: docs/design/src/900-appendices.md#8124ef4cfd203889 — Chapter 900: runtime schema computed keys
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: runtime schema computed keys — For `schema` and `schema error`, computed names use native TypeScript runtime object-literal grammar and key-type checks, and execute once in native property evaluation order.")

// rule-evidence: docs/design/src/900-appendices.md#f86f2c3c50513612 — Chapter 900: erased payload computed keys
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: erased payload computed keys — For plain `error` and `data` payloads, they use native TypeScript type-member checks and are erased.")

// rule-evidence: docs/design/src/900-appendices.md#df4e0b5f277b4eaa — Chapter 900: type versus runtime computed key admission
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: type versus runtime computed key admission — A broad entity-name key can be admitted in a type member while a call, parenthesized or element-access expression receives `TS1170`; the corresponding runtime schema key can still be admitted.")

// rule-evidence: docs/design/src/900-appendices.md#02314388ac9ba1b1 — Chapter 900: async match nested await boundary
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: async match nested await boundary — The expression can occur inside a plain function: its own `await` does not make that enclosing function async.")

// rule-evidence: docs/design/src/900-appendices.md#8b1ebfa30a4575ca — Chapter 900: empty match list unique derivation
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: empty match list unique derivation — This replaces the pinned draft's optional `MatchList`: the existing `MatchList` is nullable, so `[]` has one derivation.")

// rule-evidence: docs/design/src/900-appendices.md#981b5bc4f4a64c03 — Chapter 900: cached empty iterable matching
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: cached empty iterable matching — Empty and nonempty paths use the same cached Iterator Record and list matching; `[]` matches only an empty iterable.")

// rule-evidence: docs/design/src/900-appendices.md#6902c0d33e85a183 — Chapter 900: regex MatchPattern alternative
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: regex MatchPattern alternative — This is one added `MatchPattern` alternative, replacing the chapter's earlier bare-literal addition.")

// rule-evidence: docs/design/src/900-appendices.md#82a882a3f6936842 — Chapter 900: regex Boolean and extractor branches
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: regex Boolean and extractor branches — The first branch is a Boolean regex test; the second uses the same extractor/list matching as a named `RegExp`, with the pinned nullable `MatchList` and inherited grammar parameters.")

// rule-evidence: docs/design/src/900-appendices.md#93288ecdba7f7196 — Chapter 900: module declaration placement
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: module declaration placement — VIP-40: TC39's module declaration, restricted to a top-level statement of a `.vibe` or `.vibex` file.")

// rule-evidence: docs/design/src/900-appendices.md#b1e3c1d444c01e9b — Chapter 900: native module body
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: native module body — `ModuleBody` is TypeScript.")

// rule-evidence: docs/design/src/900-appendices.md#14a5503df0492618 — Chapter 900: identifier module specifier locality
// Deferred: verify the complete stated syntax, diagnostic, type or runtime obligation.
test.todo("Chapter 900: identifier module specifier locality — An identifier `ModuleSpecifier` appears in VibeLang code of the same file only.")
