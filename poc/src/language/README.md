# Checked `.sm` frontend POC

This is the current compiler-shaped risk spike, not the old custom-syntax
prototype. Source is parsed and resolved by `typescript-js`; `.sm` keeps the
TypeScript surface where it is useful and deliberately changes effectful
control flow.

## Public API

All programmatic entry points are Node-compatible and perform no writes:

```ts
import {
  analyzeProject,
  analyzeSource,
  checkEmittedTypeScript,
  compileAndCheckProject,
  compileAndCheckSmithers,
  compileProject,
  compileSmithers,
  emitProjectDeclarations,
  readDeclarationEffects,
} from "./index.ts"

const project = analyzeProject([
  { fileName: "domain.sm", source: domainSource },
  { fileName: "app.sm", source: appSource },
], { rootDir: "/absolute/project" })

// project.files["app.sm"].rows contains rows after cross-module propagation.
// project.diagnostics adds fileName to every ordinary source diagnostic.

const checked = compileAndCheckSmithers(source, {
  fileName: "/absolute/input.sm",
  outputFileName: "/absolute/input.generated.ts",
  runtimeImport: "../runtime/index.ts",
  sourceName: "input.sm",
})

if (!checked.ok) {
  // checked.result.analysis.diagnostics are language diagnostics.
  // checked.emitDiagnostics are stock TypeScript diagnostics for generated TS.
}
```

- `analyzeSource(source, { fileName? })` returns discovered errors, function
  channels, inferred failure/requirement rows, and source-located diagnostics.
- `analyzeProject([{ fileName, source }], { rootDir? })` builds one in-memory
  TypeScript Program for the supplied `.sm` modules. It resolves relative
  modules and import aliases, propagates direct-call Error/Context rows through
  cycles to a fixed point, and returns per-file analysis plus stable aggregate
  diagnostics. It performs analysis only and does not emit files.
- `compileSmithers(source, options)` returns generated TypeScript, the analysis,
  and a deterministic version-3 source map with embedded authored content. It
  does not claim the result is accepted.
- `compileProject(sources, options)` lowers the complete supplied in-memory
  module set, rewrites relative `.sm` imports to their output names, and
  returns virtual files without writing them. `preserveSmithersSpecifiers: true`
  instead emits every relative authored `.sm` specifier exactly as written
  (including extensionless and `./x.js` spellings that resolve to a supplied
  `.sm` source) while keeping the whole cross-module checker pass, row
  propagation, and diagnostics identical. It is for an external bridge that
  owns the final `.sm`->`.js` rewrite and needs authored text at authored
  source-map columns; the emitted modules are then not directly stock-checkable,
  so `compileAndCheckProject` is not meaningful with it. Compiler virtual
  modules, non-`.sm` relative specifiers, and asset import-attribute
  stripping are unaffected.
- `checkEmittedTypeScript(code, fileName)` validates an in-memory output with a
  strict stock TypeScript Program.
- `compileAndCheckSmithers(source, options)` is the acceptance API: `ok` is true
  only when both language analysis and emitted TypeScript are error-free.
- `compileAndCheckProject(sources, options)` applies the same acceptance rule
  to one stock TypeScript Program containing all generated modules.
- `emitProjectDeclarations([{ fileName, code, effects? }])` emits virtual
  declarations. `DeclarationSource.effects` attaches normalized inferred rows
  to exported declarations as strict, versioned `@smithersEffects` metadata;
  `readDeclarationEffects(code, fileName?)` is the public fail-closed decoder.
  This metadata is explicitly provisional and non-normative: it preserves POC
  evidence without deciding the eventual declaration/type encoding.

The bounded project/ownership checks use stable codes:

- `SMITHERS1002`: the internal `typescript-js` parser-diagnostics field is absent,
  so grammar acceptance cannot be proven and analysis fails closed.
- `SMITHERS1107`: class `static {}` initialization blocks are unsupported; they
  execute outside every checked function channel.
- `SMITHERS1205`: a `panic(...)` or postfix `!`
  propagation point sits lexically inside a JavaScript `try` with a `catch`
  clause; its early-return lowering would silently bypass the catch handler.
- `SMITHERS1511`: a top-level `throw` statement cannot be represented as a checked
  Result (mirrors the `SMITHERS1505` top-level panic rule; `SMITHERS1505` also covers
  top-level `Result.expect()`).
- `SMITHERS1601`/`1602`/`1603`: the host-global prohibition, and it is an
  **allowlist**, not a list of forbidden spellings. Authored `.sm` may reach the
  ECMAScript-262 global object (`UNIVERSAL_GLOBALS`) and nothing else the ambient
  environment publishes; `Date`, `Math`, `performance`, `crypto`, and `Intl` are
  reachable but judged per *operation*, so `Math.max` stays available while
  `Math.random` needs `Random` and `Intl.DateTimeFormat` needs `Clock`.
  The rule was a denylist of eight names until it was measured: 22 of 38 sibling
  globals compiled clean and ran, because `self`/`top`/`parent`/`frames` alias
  the global object in every DOM and worker host, `XMLHttpRequest`/`WebSocket`/
  `EventSource`/`Worker` are the network and thread authority
  `specification/compatibility.mdx` names in the same sentence as `process`, and
  `navigator`/`location`/`localStorage`/`sessionStorage` are host identity and
  host-persistent state. A denylist over a namespace the host may extend cannot
  be completed; an allowlist over the namespace the checker actually resolves
  can. The criterion is that page's "Host Globals": platform-specific globals
  MUST NOT be ambient, and universally present facilities MAY be — and where
  that text does not settle an edge (`URL`, `TextEncoder`, `AbortController` are
  present everywhere and are still host APIs), ECMA-262 is the completable line,
  because the second clause is a MAY and the first is a MUST NOT.
  `ALWAYS_FORBIDDEN_HOST_GLOBALS` additionally refuses the canonical host names
  and the Node global scope *by name*, so that whether `@types/node` happens to
  be installed cannot decide the verdict — the reference frontend pins
  `types: []` for the authored-`.sm` program and the pinned fork carries no
  ambient `@types/node`, and before this the two disagreed on nine names. Both
  directions are gated in `host-global-allowlist.test.ts` and, on the fork, in
  `compiler/fork_failclosed_test.go`'s `TestPinnedForkHostGlobalAllowlist`.
  `import.meta` is refused by the same rule and the same code, through a
  separate node test: it is a **meta-property**, not an identifier, so an
  identifier-keyed rule never saw it at all, and ECMA-262 hands its properties
  to the host (`HostGetImportMetaProperties`) — host authority by this
  allowlist's own criterion. `import.meta.url` compiled with an empty row and
  RAN, printing the host filesystem path; `import.meta.dirname` and
  `import.meta.filename` compiled here while the pinned fork answered TS2339,
  which is exactly the backend divergence the `__dirname`/`__filename` entries
  in `ALWAYS_FORBIDDEN_HOST_GLOBALS` exist to close, reopened through a
  spelling with no name to list. `new.target` is the other meta-property and is
  deliberately untouched: it is the language's own and reads nothing from the
  host.

- `SMITHERS1604`: **dynamic code evaluation.** `eval` and `Function` are in
  ECMA-262 clause 19 and were therefore *in* the allowlist above — and the
  allowlist's own note on `globalThis` says why that is wrong: it is "the one
  language global whose whole purpose is to hand back the host's namespace, so
  admitting it would readmit every name this set excludes." That sentence is
  true of these two verbatim. Measured, on both backends, each with
  `failures: [] requirements: []` and no diagnostic, each RUNNING:
  `eval("process.platform")` → `darwin`, `eval("Date.now()")` → a wall-clock
  instant (the direct spelling is `SMITHERS1602`), `eval("Math.random()")` →
  randomness (`SMITHERS1603` directly), `new Function("return process.platform")()`
  → `darwin`, and `eval("globalThis.process.platform")` → `darwin`, which is the
  by-name `globalThis` refusal defeated by one sibling spelling. Twenty
  spellings of one class; two `MUST`s in `specification/compatibility.mdx`
  §Host Globals violated with nothing reported.
  The rule is per *operation*, not per name — the shape `crypto` already has,
  and for the same reason: there is no capability that could provide "run
  arbitrary host code", so a requirement row would be a refusal wearing a
  costume. `Function` stays a usable TYPE annotation and
  `value instanceof Function` stays a prototype test (only the RIGHT operand,
  as for `Date`); reading the binding is what is refused, because every escape
  spelling reaches the callee through a read — an alias, `(0, eval)`,
  `Reflect.apply(Function, …)`, and a shorthand `{ eval }` were each measured
  executing host code. A second arm covers the route with no name to key on:
  `(function () {}).constructor` IS the `Function` constructor, so a
  `constructor` selection off a *callable* receiver is the same authority, while
  `({}).constructor`, `[].constructor` and an instance's own stay ordinary.
  `specification/compatibility.mdx` §Dynamic Features ("`any` and `eval` remain
  usable … the language does not forbid them") and §Host Globals overlap here;
  what happens to an `eval` whose argument reaches no host name at all is a
  specification decision that is **not settled by this rule** — it fails closed
  until that sentence is written. Both directions are gated in
  `host-global-allowlist.test.ts`. A receiver typed `any`
  (`Object.getPrototypeOf(fn).constructor`) still escapes; that is the standing
  `any` hole, which defeats every checker-typed rule in this file.

- `SMITHERS1801`: a relative `.sm` import is absent from the supplied project;
  `SMITHERS1804`: a named/default import is not an exported value in that module.
- `SMITHERS1802`: a cross-module function becomes a **value** that escapes
  direct static-call analysis — aliased to a binding, handed to a callback, put
  in an array or object literal (the shorthand `{ f }` included), `bind`-ed,
  exported as a default expression, used as a template tag, or called from a
  parameter default. It is **not** a refusal of ordinary calls: a call at module
  top level, a call in a class property initializer, a parenthesized callee
  `(f)(x)`, an accessor access, a re-exported binding `export { f }`, and a
  `typeof f` entity name all keep their attributed row and are accepted. The
  test is "was this callee's row charged somewhere" — see `isAnalyzedCallSite`,
  which is why a parameter default stays closed and a class property
  initializer does not.
- `SMITHERS1803`: a polymorphic failure-row template cannot be instantiated. Either
  a call site leaves a row variable unresolved (the caller forwards its own type
  parameter, or a conditional/indexed row stays deferred), or a generic
  declaration's row names its own type parameters without a spelled `Result`
  contract to instantiate through. A generic success type with concrete
  failure/requirement rows never needs instantiation.
- `SMITHERS1806`: an instantiation would publish a failure row that a callback
  argument's own explicit Result contract cannot nominally produce (for example
  an explicit type argument naming a sibling Error class).
- `SMITHERS1805` is retired: row members now carry module-qualified nominal
  identities, so two modules may declare same-named Errors/Contexts.
- `SMITHERS1303`: an inferred-fallible function crosses a general callback
  boundary without an explicit Result contract. The boundary is a *value* edge,
  not an argument position: the rule follows every function an argument carries,
  including through parentheses, `as`/`satisfies`, object literals (property
  assignments, shorthand methods, and shorthand *names*), array literals, and a
  `new` expression's arguments — `match({ error: cb })` hands `cb` over exactly
  as `map(cb)` does. A shorthand name resolves through
  `getShorthandAssignmentValueSymbol`: `getSymbolAtLocation` on it returns the
  object literal's *property*, so `{ cb }` used to compile where
  `{ cb: cb }` was refused.
  Function *bodies* are not entered; a callback nested inside another callback is
  checked at its own call site. An **inferred** Result return type only counts as
  a contract when no postfix `!` contributed to it, because the stock checker
  still computes `!` with the non-null-assertion meaning `.sm` abolishes and a
  propagating callback would otherwise appear to return the Result it extracts
  from. `SMITHERS1404` below is deliberately *not* widened the same way: it is a
  rule about started work, not about a lost failure channel.
- `SMITHERS1404`: an async callback has no compiler-recognized owner. The rule is
  over *started* work, so the recognized owners are `Result.tryPromise`, a
  consumed `Layer.provide`, and the `smithers:native` pin — `native(fn)` receives
  a function reference, asserts over its transitive graph, and returns it without
  invoking it, so it starts no Promise and an async subject is accepted. The pin
  is recognized by prelude symbol identity, so a locally declared `native` owns
  nothing and keeps the general rule.
- `SMITHERS2105`: a fallible `Layer.provide` callback needs an explicit Result or
  `Promise<Result>` contract.
- `SMITHERS2106`: the receiver of `Capability.context()` does not identify
  exactly one `Context` subclass. `specification/requirements.mdx` §Context
  Access: the receiver "MUST identify a `Context` subclass strongly enough for
  the compiler to record its nominal key" — and when it did not, the analysis
  recorded **nothing** instead of refusing. The runtime keys the lookup on the
  constructor the receiver evaluates to, so an unpinned receiver produced a
  checked program that reads a capability its row does not name: a union
  parameter, a `??`/`||` over two capabilities, a tuple element under a union
  index, an index-signature lookup, a generic type parameter (a bound never
  pins the key — a *subclass* is still substitutable), an intersection, an
  anonymous `class extends Context` expression, and a structural cast inside a
  generic helper all published `requirements: []` while reading a capability.
  Worse than the empty row is the **misattributed** one: TypeScript
  subtype-reduces a union of structurally identical constituents to its first
  one, so `(flag ? Db : Log).context()` recorded `["Db"]`, a
  `Layer.provide(Layer.succeed(Db, db), …)` satisfied that declared row, and the
  program panicked with `capability 'Log' was not provided`. Nothing in the
  reduced TYPE remembers `Log`, so the receiver is resolved from the SYNTAX
  first (`receiverBranches`, `constantInitializer`) and only then from the
  checker type. A type assertion is asked about its OPERAND first, because `as`
  changes the type and never the value: `(Db as any).context()` and
  `(Db as unknown as { context(): Db }).context()` both invoke `Db`'s inherited
  static and now record `Db` rather than nothing.
- `SMITHERS2107`: a **detached** reference to the compiler-recognized
  `Context.context`. The row is recorded at the call site from the receiver, so
  every spelling that separates the member from its receiver erases the row
  while keeping the capability read — `Reflect.apply(Db.context, Db, [])`
  checked `ok: true` with `requirements: []`, ran, and returned the provided
  service. The `.call`/`.apply`/`.bind`/alias/destructuring spellings were
  refused only *incidentally*, by the stock type check over the emitted module
  (the prelude's `this`-parameter makes a detached receiver unresolvable), which
  is why `smithers inspect` reported `ok: true, requirements: []` for a file
  `smithers check` refused, and why the Go fork's looser prelude typing accepted
  all of them. It is now a rule: the member is a call, not a value. Type
  positions (`typeof Db.context`) read nothing and stay legal.
- **A requirement crosses a callback boundary.** The boundary was already
  modelled for the other two channels — a callback that can fail is refused
  (`SMITHERS1303`) and an async one is refused (`SMITHERS1404`) — but the R row
  crossed it deleted: `xs.map((x) => Db.context().find(x))` published
  `requirements: []` while reading `Db` through the ambient scope, and an
  authored higher-order call, a `new Promise` executor, and a trusted foreign
  host callback did the same. That also made the top-level
  unsatisfied-requirement check escapable — a shape the corpus pins for direct
  calls became reachable by wrapping the read in `xs.map(...)`.
  `SemanticFunction.callbackValues` wires the row to the same *value* edge
  `checkCallbackOwnership` walks, so the three channels cannot drift apart on
  which handovers they see. The `Layer.provide` computation is the one argument
  excluded: `checkLayerSatisfaction` already reconciles its row against the
  layer's provided closure. Still open, and deliberately: a closure RETURNED
  from a function carries its requirement invisibly, because the function type
  has no row to carry (`specification/requirements.mdx` leaves the declaration
  encoding open).
- `SMITHERS2102` is charged at module scope for a capability read written
  *directly* at top level and for a callback handed to a top-level higher-order
  call, not only for a top-level call to a function whose row names the
  capability. `collectFacts` runs per function, so a direct top-level
  `Db.context()` was charged to nobody and panicked at run time while its
  indirect spelling was already refused.
- `SMITHERS1504`: a **call-like** foreign form whose Result lowering is deferred
  is not accepted unless its resolved signature declares `@throws {never}`. Three
  spellings reach it, and they are one rule: `new Foreign(...)`, a foreign
  **tagged template** (the tag is a call that never appears in call position),
  and the two forms that invoke a foreign constructor or function with no call
  expression at all — `class X extends Foreign {}` (an implicit `super(...)`) and
  a foreign **decorator** (invoked when the declaration is evaluated).
  `SMITHERS1505`: a checked foreign panic channel appears at top level.
- `SMITHERS1506`: a foreign property/accessor read needs an annotated adapter —
  **including the reads no property-access node spells**. `implicitInvocationProtocol`
  is one predicate over an expression's POSITION: `for…of` / `for await…of`,
  every spread (`[...x]`, `f(...x)`, `new C(...x)`), `yield*`, and array
  destructuring assignment run `x[Symbol.iterator]()`; object spread and object
  destructuring assignment run the value's own getters; template interpolation,
  every coercing unary/binary/compound operator, `instanceof`'s right operand,
  `in`'s left operand, a computed property key and an element-access key all run
  `Symbol.toPrimitive`/`valueOf`/`toString`. Each of those is a method call on a
  foreign value with no call expression to lower, so each one was fail-open while
  the machinery was keyed on `ts.CallExpression`/`ts.NewExpression`. It is ONE
  predicate rather than a list of reporting sites on purpose: enumerating sites
  is how this class kept reopening — every unforeseen sibling stayed silently
  fail-open — whereas asking the position a single question makes the answer
  total over the grammar. Two gates keep it from widening: the value must have
  foreign provenance, and `foreignValueCanExecute` must be true, so a trusted
  binding's `string` may still be interpolated, iterated and spread because
  `String.prototype`'s protocol members are the language's, not the module's.
  The read half of the rule asks the **receiver** one question and nothing else:
  does the value this member is being read off have foreign provenance? The
  member's own declarations are not consulted, on either backend. The fork used
  to state that rule in a comment and then contradict it with a second gate that
  walked the member's declarations, and that gate was the fail-open recorded as
  `09-foreign-calls/a-foreign-index-signature-read-is-refused-on-one-backend-only`:
  `keyed.width` through a `Record<string, number>` index signature resolves to a
  member with NO declarations, an empty declaration list is not evidence of a
  trust claim, and the fork compiled, ran and exited 0 on a program the
  reference refuses. The declaring FILE was never the question either — nothing
  stops a foreign object from serving `length` or `toString` from a throwing
  getter while the member's only declaration is in `lib.es5.d.ts`. Asking the
  receiver makes the answer total over the spellings: dotted and element access,
  a literal or computed key, an index signature, an `any`-typed member, a write,
  an optional chain, and a destructuring pattern are one rule rather than eight.
  `SMITHERS1507`: a foreign factory/result is invoked before an expression-safe
  propagation/local binding.
- `SMITHERS1502` also refuses two `@throws` claims that cannot be honoured, both
  read through `foreignThrowsAnnotation`, the single admission point:
  a declaration carrying **more than one distinct** `@throws` (taking the first
  tag made `{never}` then `{TypeError}` trust the binding AND drop the declared
  channel, while the identical pair in the opposite order refused it — the same
  two claims must not give opposite verdicts, and only one order failed closed);
  and `@throws {never}` on an **async or `Promise`-returning** binding, because
  `compatibility.mdx` §Foreign Boundary makes the marker an opt-out for the
  *call* — "JavaScript and TypeScript may throw, REJECT, or violate a
  declaration" — and an `async` function does not throw at the call, it rejects
  afterwards, so the marker describes a channel it does not cover. The untrusted
  spelling of the same binding already charges `Panic`
  (`09-foreign-calls/foreign-rejection-becomes-panic`), which is what makes the
  trusted direction the fail-open one. It is refused rather than ignored so an
  author can tell a believed claim from a dropped one.
  A trust claim belongs to the **resolved signature**, never to the symbol:
  `readThrowsClaim` reads `checker.getResolvedSignature(...).declaration` and
  falls back symbol-wide only for a single-declaration symbol. Overload
  signatures are separate declarations of one symbol, so the old
  `symbol.declarations.flatMap(getJSDocTags).find(throws)` let one marked
  overload certify the unmarked, throwing overload a call actually resolved to —
  and the property analogue (`foreignAccessPolicy`) now requires **unanimity**
  across a merged property's declarations, preferring an unannotated one, since
  a property read has no resolved signature to consult.
- `SMITHERS1508`: executable foreign provenance escapes through an unsupported
  higher-order/return/store boundary; `SMITHERS1509`: a callback may escape into
  **untrusted** foreign code outside the checked call scope.
  Provenance does **not** depend on how a property is spelled. `{ handler }` and
  `{ handler: handler }` are one program, and every rule that resolves an
  identifier to its declaration must read the shorthand through
  `referencedValueSymbol` — `checker.getSymbolAtLocation` answers the object
  literal's *property* symbol for a `ShorthandPropertyAssignment` name, and the
  dead end is FAIL-OPEN rather than unknown. That single accessor is now the
  only place in this file that knows the rule; `expressionSymbol` (for
  `SMITHERS1303`/`SMITHERS1802`), `isAmbientGlobalReference` (for
  `SMITHERS1601`/`1602`/`1603`), and the provenance walks all route through it.
  Four rules have had this defect: `SMITHERS1303` and `SMITHERS1802` were closed
  first — see `07-must-consume/a-shorthand-property-name-carries-the-same-callback-contract`
  and `15-generic-rows/an-object-literal-shorthand-escape-is-rejected` — and
  `SMITHERS1508` and `SMITHERS1601` were still open afterwards precisely because
  each resolved the name itself. Both directions are gated in
  `foreign-shorthand-provenance.test.ts` and, on the fork, in
  `compiler/fork_shorthand_provenance_test.go`.
  Two more questions now have exactly one answer each, for the same reason.
  **"Which member does this key select?"** is `staticKeyName`, and the criterion
  is the checker's string LITERAL type, not `ts.isStringLiteralLike` — that is
  precisely when TypeScript resolves the access to one property symbol, which is
  the criterion `05-context-rows/a-non-literal-computed-capability-access-has-no-statically-known-member`
  states in prose. Matching the spelling instead let `Clock[("context")]()`,
  `Clock["context" satisfies string]()`, `Clock[KEY]()`, `Clock[<"context">"context"]()`
  and three more siblings publish `requirements: []`, check `ok: true`, and PANIC
  with `capability 'Clock' was not provided` — the exact program
  `a-computed-context-access-charges-the-same-row` certifies as `SMITHERS2102`.
  The same helper serves the `Date`/`Math` per-operation walk, where the drift
  ran the other way and `Date[PARSE]`/`Math[MAX]` were over-refused.
  `selectedMemberSymbol` is its companion: `checker.getSymbolAtLocation` answers
  the member only where the member is *spelled*, so a rule that resolved the key
  node directly went blind at exactly those spellings.
  **"Where does this value end up?"** is `forwardingParent`, the PARENT direction
  of `typeOnlyWrapperOperand`, and it asks
  `typeOnlyWrapperOperand(parent) === current` so the two directions are the same
  table rather than two tables that agree today. Three walks had restated that
  table by hand and none knew `satisfies`: measured,
  `(inferred("bad") satisfies unknown)!` and `const r = inferred("bad"); return r!`
  published `failures: ["Calm"]` over a body that can only produce `Boom` and
  reported no `SMITHERS1104` at all, while the byte-adjacent `as` spelling
  reported it. The charge itself also had to move INSIDE the `inferRows` fixpoint
  (`SemanticFunction.channelSites`): a propagated value's channel is
  `effectiveChannel(callee)`, which the fixpoint is still computing, so reading it
  during collection answered "plain, no failures" for exactly the
  inferred-fallible callees the charge exists to catch.
  The trust marker is honoured in the ARGUMENT position, not only on the call's
  own channel. `specification/compatibility.mdx` §Foreign Boundary makes the
  panic case a property of the *call* — "Trusted `@throws {never}` metadata opts
  out; `@throws {T}` declares a more precise channel" — so a claim made about a
  call covers a listener that call was handed, and
  `specification/requirements.mdx` §Scoping assigns the deferred half explicitly:
  "Imported JavaScript or TypeScript that starts hidden background work owns
  that work. Caller-controlled background APIs MUST expose explicit completion
  or disposal handles through their adapters." That is the route every host
  callback registration takes — `process.on`, `setTimeout`, `socket.on`,
  `readline`. Requiring the callback to be independently panic-free is not
  available: `failures.mdx` §Panic Does Not Widen a Return Type makes
  panic-freedom unspellable, so such a rule would admit nothing.
  A **trusted** call therefore falls through to the `SMITHERS1508` argument
  check, so a *foreign* callable handed on through it is still refused — a claim
  about this callee cannot speak for another module's panic provenance. The
  callback's own inferred Result channel stays `SMITHERS1303`, started async work
  stays `SMITHERS1404`, and a host global in the callback body stays
  `SMITHERS1602`; none of those consults the boundary's trust. Both directions
  are gated in `foreign-callback-trust.test.ts` and, on the fork, in
  `compiler/fork_callback_trust_test.go`.
- `SMITHERS1510`: a TypeScript/JavaScript module edge lacks a leading JSDoc
  module-initialization trust claim containing both `@module` and
  `@throws {never}`. Both tags and the `never` inside the braces are matched
  with **exactly** the case printed here, on both backends: `specification/
  failures.mdx` §Foreign Exceptions gives `@throws {never}` and `@throws {T}` as
  two productions of one syntax, `T` is a case-sensitive TypeScript type name,
  so `{Never}` is the second production and folding case would silently promote
  an unreifiable channel to the trusted opt-out. Type-only imports and compiler
  intrinsics are exempt.
  The marker's **comment kind is the scanner's answer**, not a substring search
  for `/** … */` in the leading text. That search asks no one whether a JSDoc
  exists: measured, `// /** @module @throws {never} */` (a line comment) and
  `/* /** @module @throws {never} */` (a plain block containing the text) both
  conferred trust on all three implementations, and the untrusted module's
  initializer RAN. Note the direction the old rule already had right —
  `/* @module @throws {never} */` with one asterisk was correctly refused — so
  it always meant to distinguish JSDoc from a block comment; it just did it by
  substring. The parser's attached `jsDoc` **tags** are deliberately not the
  source, even though they would supply parsed tag names: measured over the 75
  marker-carrying files in this repository, a tag-based rule disagrees in 21
  places and in BOTH directions, because TypeScript attaches only the *last*
  JSDoc block before a statement (so "module header, then the first export's own
  doc comment" loses the header — 15 modules, `conformance/support/foreign.ts`
  among them) and because the JSDoc parser strips a `*` decoration inside a tag
  (so `conformance/support/split-trust-marker.ts`, a near-miss the corpus exists
  to keep refused, would have been granted trust).
  The whitespace class is the exact JSDoc one, `[ \t\r\n]`, and not `\s`. `\s`
  matches U+00A0, U+000C, U+000B, U+FEFF and every Unicode space separator, so
  `@throws {<NBSP>never<NBSP>}` conferred trust here while the fork's
  `isJSDocWhitespace` refused it — eight measured divergent spellings, with the
  reference on the fail-open side. The fork is right by this rule's own
  argument: `{<NBSP>never<NBSP>}` names a type whose spelling is not `never`,
  which is the `@throws {T}` production. `isModuleInitializationTag` shares the
  same pattern object rather than a second copy, so a comment cannot be a module
  claim for one rule and an ordinary function doc for the other. The
  rule covers the **dynamic** spelling too: a rule about module initialization
  may not be escapable by re-spelling the edge, and `import("./untrusted.ts")`
  runs that initializer before any call boundary exists exactly as the static
  form does. What stays available is what `docs/DECISIONS.md:266` locks — a
  dynamic import of another *project* module, or of a foreign module that
  carries the claim, is ordinary. Only an untrusted foreign edge and an edge
  whose destination cannot be resolved are refused, and a dynamic **asset**
  import (an import call carrying import attributes) is owned by the
  source-asset pass and keeps its own `52xx` diagnostics.
- `SMITHERS1201`: a compiler hook is being used as an author-facing Result
  constructor. It covers two spellings of one Locked sentence —
  `specification/failures.mdx` §Compiler Lifting: "Authors MUST NOT need to
  write `Result.ok(...)` or `Result.err(...)`. Those constructors MUST NOT be
  part of the ordinary Smithers authoring API." The first spelling is
  `Result.ok(...)` itself. The second is reaching the runtime's own
  `__vsResultSuccess` / `__vsResultFailure` / `RuntimeValues` **by name**
  through a compiler-intrinsic module specifier, which was open: every
  intrinsic specifier resolves to the runtime index, the index re-exports all
  three, and `poc/src/runtime/values.ts` documents the invariant that was being
  violated in its own docstring — `RuntimeValues` "must never be re-exported
  under a name a Smithers author could reach". Measured before the rule:
  `import { __vsResultSuccess } from "smthrs/context"` compiled with zero
  diagnostics and hand-built both Result variants. The refusal is anchored on
  `COMPILER_INTRINSIC_SPECIFIERS`, so an author's own module exporting the same
  name is untouched, and it covers renames, namespace member reads and
  re-exports; type-only bindings are exempt, as they are for every module rule.
  Both directions are gated in `compiler-result-constructors.test.ts` and, on
  the fork, in `compiler/fork_error_brand_test.go`.
- `SMITHERS1717`: a conditional declaration
  (`if (const user = cache.get(id); user !== null) { ... }`) has a shape whose
  binding scope is not textually provable: a braceless branch anywhere in the
  `if`/`else if`/`else` chain, `var` (which hoists out of the construct), a
  header without exactly one depth-1 `;`, an empty declaration or condition, or
  an unbalanced chain.
The CLI has the same acceptance rule and does not write output on either class
of error:

```sh
bun poc/src/language/cli.ts \
  poc/examples/language/demo.sm \
  poc/examples/language/demo.generated.ts
bun poc/examples/language/demo.generated.ts
bun test poc/src/language/
```

`generic-rows.test.ts` covers polymorphic
failure/requirement row instantiation, including the adversarial instantiations
that would publish an unsound row; `qualified-rows.test.ts` executes two modules
declaring same-named Errors; `nominal-errors.test.ts` covers the type-only
nominal merge; `conditional-declarations.test.ts` covers declarations in
conditionals and executes `examples/language/conditional-declarations.sm`.

The CLI implementation uses Node APIs only. Bun is shown because this repo
already uses it to execute TypeScript directly; a Node integration can import
the API or run the source with Node's TypeScript stripping enabled.

## What this POC proves

- Failures are inferred to a fixed point from ordinary `Error` subclasses,
  throws, calls, checked `panic`, foreign boundaries, and postfix `!`.
  The project API carries failure and Context rows through direct static calls
  across relative imports, aliases, namespace access, cycles, and exported
  arrow functions using checker symbol identity.
- A generic function whose declared `Result` error mentions its own type
  parameters is a polymorphic row template. Every checker-resolved direct static
  call instantiates it: the resolved signature already carries the site's
  explicit or inferred type arguments, so the instantiated error type is read
  back from it and wholly replaces the template at that site. Two call sites of
  the same generic therefore never merge rows, nested generic calls compose,
  concrete Context requirements of the template survive instantiation unchanged,
  and instantiated rows take part in ordinary fixed-point propagation and
  `@smithersEffects` declaration metadata. Because two authored
  `class X extends Error {}` declarations are the same *structural* type, an
  instantiation is additionally required to nominally cover the declared row of
  every callback argument that carries its own explicit Result contract
  (`SMITHERS1806`); base-class coverage counts, so deliberately widening a type
  argument is allowed and shows up as an ordinary `SMITHERS1104` contract mismatch.
  Anything the checker cannot resolve at the site stays fail-closed
  (`SMITHERS1803`), and a generic value that escapes direct static-call analysis
  keeps `SMITHERS1802`.
- **An accessor access is an ordinary call.** Reading `box.size` CALLS the
  getter and `box.first = 1` CALLS the setter; no syntax names an accessor
  without running it. `specification/requirements.mdx` §Inference is normative:
  "Calling a function with unsatisfied requirements MUST add those capabilities
  to the caller's `R` row. ... Requirement inference MUST be transitive through
  ordinary calls." Every spelling charges the accessor's requirement row —
  property access, element access with a literal key, optional access, compound
  assignment, and object destructuring (`const { size } = box`, renamed or not)
  — and a top-level accessor access reports `SMITHERS2102` exactly as a
  top-level call does. The accessor's *failure* row is deliberately not charged:
  a getter yielding `Result<A, E>` hands the reader a Result **value**, which
  must-consume and postfix propagation already govern.
  Before this edge no accessor access charged anything on either backend, and
  the only shape that was refused was a cross-module get-only READ — refused by
  `SMITHERS1802`, incidentally. A same-module accessor, a setter, and a get/set
  pair all compiled with the capability silently dropped, including at a
  `Layer.provide` site that then aborted at run time.
- Public fallible functions require explicit `Result<A, E>` contracts. Returns
  and throws lower to explicit Result constructors, and postfix `!` lowers to an
  inspected early `return` of the same error.
- Absence uses ordinary `T | undefined` or `T | null` unions. Narrowing,
  optional chaining, and nullish coalescing retain their TypeScript behavior;
  the compiler adds no lifting or propagation channel for absence.
- `Result.expect(...)` consumes the Result but converts its error variant into
  a panic, so it charges the distinguished `Panic` channel to the enclosing
  function's inferred failure row; at top level it is rejected like any other
  unconsumable panic channel (`SMITHERS1505`).
- The public `Result.try`/`Result.tryPromise` adapters are accepted in
  authored `.sm` with their documented Panic-retaining types. The inline
  callback body is an authored boundary: foreign calls inside it are not
  re-wrapped or re-typed (the authored boundary owns the throw scope), and the
  callback's Context requirements still propagate to the caller. Non-inline
  callback references and foreign accessor reads inside the callback keep
  their conservative fail-closed diagnostics.
- `panic` from the compiler exception module and ambient `Reflect.panic` are
  recognized by checker symbol identity. Authored bindings with those spellings
  are not compiler intrinsics.
- **An authored `panic(...)` exit does not widen a return type.** It is not
  charged to `directFailures`, so it cannot make a function infer a Result and
  cannot draw `SMITHERS1101`/`1102`/`1105`/`1106` on its own. `specification/
  failures.mdx` §Panic Does Not Widen a Return Type is normative: "Calling
  `panic(...)` MUST NOT force a function's return type to widen into
  `Result<A, Panic>`", because the panic case is "tracked separately from
  ordinary recoverable Error variants" and "Ordinary Result recovery MUST NOT
  swallow panic implicitly" — and `E` is the *expected*-error channel, which a
  panic is not. The panic stays tracked on the `CallEdge` (`panicExit`), where
  the placement rule (`SMITHERS1503`) and the lowering read it.
  - **The materialization is keyed on the published row naming `Panic`**, not on
    "this function returns some Result": an author who writes
    `Result<A, Panic>` still gets `return __vsResultFailure(__vsPanicValue(...))`,
    while `Result<A, Missing>` — declared or inferred — lowers the panic to
    `throw __vsPanicValue(...)`. Materializing into a channel that does not name
    `Panic` would put a `Panic` where a caller's exhaustive `match` believes only
    `Missing` can appear.
  - Everything that is not a panic is untouched. A **recoverable** `throw` still
    obeys the older MUST on the same page — "A `.sm` function with a reachable
    recoverable Error exit MUST return or infer a Result" — so `SMITHERS1101`,
    `1102`, `1105`, and `1106` all still fire for it. So does the **foreign**
    panic case: an unannotated foreign call still charges `Panic` to the row,
    because failures.mdx §Foreign Exceptions makes that a checked obligation the
    caller must propagate, catch, or adapt.
  - `Result.expect(...)` is deliberately NOT moved onto the separate track. It
    is a distinct spelling with its own rule below, and leaving its `Panic` in
    the recoverable row keeps its current diagnostics exactly as they were.
- Imported TypeScript/JavaScript runtime values retain checker-declaration
  provenance through namespace selection, local aliases, immutable object/array
  storage, methods, and explicitly propagated factory results. Supported calls
  become `Result.try`/`tryPromise` with `Panic`; checker-resolved `@throws
  {never}` is trusted, while `@throws {SomeError}` validates the foreign value
  and exposes `SomeError | Panic` so a violated contract remains `Panic`.
- Foreign module evaluation is checked separately from calls because an ESM
  initializer can fail before any Result boundary exists. Static foreign
  modules fail closed unless their leading JSDoc contains both `@module` and
  `@throws {never}`, matched with exactly that case; that module tag never
  doubles as a function-level opt-out, and the `@module` test that separates the
  two is the same exact-case test, so one spelling cannot be a module claim for
  one rule and an ordinary function doc for the other.
  A trusted thin module may instead expose an unannotated async function using
  dynamic `import()`, whose rejection is handled by the ordinary foreign-call
  Panic boundary. A graph reached only through that dynamic edge needs no
  initializer trust marker.
- Property/accessor evaluation, constructors, and higher-order escapes use a
  conservative gate where lowering cannot preserve evaluation order. A getter
  or constructor with resolved `@throws {never}` is accepted; otherwise the
  frontend reports an adapter-oriented hard diagnostic. Any callback passed
  into foreign code is rejected until a Smithers-owned Result/task adapter defines
  its invocation and lifetime.
- `ContextSubclass.context()` contributes a nominal requirement. Known
  `Layer.succeed`, `merge`, and `provide` compositions satisfy requirements and
  unsatisfied top-level programs fail.
- Produced Results and Promises must be consumed. Promise instance chaining is
  rejected in authored `.sm`. Inferred-fallible callbacks and unowned async
  callbacks fail closed instead of silently losing a Result or Promise channel.
  A `return` is a **transfer**, not a discharge, and the two ends of a transfer
  ask ONE question — "does the type this value has here still carry a
  must-consume channel?". `heldObligation` asks it of the value a call hands
  back, so a callee that moved its Results into a container and returned them
  now charges its CALLER (`SMITHERS1301`, or `SMITHERS1402` for a container of
  started Promises), and `transferReachesCaller` asks it of the enclosing
  function's return type, so `function f(): unknown { return [make()] }` cannot
  launder the obligation past a type no rule can charge. Before that pair,
  `return [save(1), save(2)]` from a `readonly Result<A, E>[]` function
  cancelled the obligation outright — the failure never reached the row, was
  never consumed, and the program exited 0 reporting success on both backends —
  while the identical array **inside one function** was refused and pinned by
  `07-must-consume/array-length-is-not-consumption-of-a-result-collection`. The
  receiving rule NARROWS the transfer rather than widening it: it asks the same
  question `07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard`
  settles for a container literal, so a lifted call whose declared type dropped
  the channel is still a discard at the element and nothing is charged at the
  call. Three producers are excluded because charging them would double-report
  one mistake or contradict a settled site: a value that IS a Result or a
  `Promise<Result>`, a started Promise that was never consumed, and a recognized
  `Promise` combinator, which `collectionConsumed` already defines as owning
  everything handed to it (`07-must-consume/the-ambient-promise-all-discharges-a-bound-promise`).
  Both directions are gated in `must-consume-collections.test.ts` and, on the
  fork, in `compiler/fork_collection_ownership_test.go`.
- Row members are module-qualified nominal identities. A name unique across the
  analyzed project keeps its plain spelling; a name declared by two modules is
  serialized as `Name@module/path`, using the same module identity that
  `stableErrorId` already gives the runtime `__vsRegisterError` call, so the
  analysis row and the runtime nominal identity cannot drift apart. Requirement
  rows, `Layer.succeed` providers, `@smithersEffects` declaration metadata, and
  `Error.match` exhaustiveness all resolve through that identity rather than
  through authored text, so import aliases and duplicate names stay exact. Two
  same-named Errors in different modules register distinct runtime identities
  end to end (`qualified-rows.test.ts` executes the emitted modules and reads
  both back through `errorIdentity`).
- Error matching is checked for nominal exhaustive class cases and lowered to
  constructor-keyed runtime cases.
- Each authored Error class is emitted with the runtime's nominal brand merged
  alongside it: `class X extends Error {}` plus
  `interface X extends NominalError<"<stableId>"> {}` and the existing
  `__vsRegisterError(X, "<stableId>")`, with `NominalError` imported type-only.
  The brand identity is the same stable id as the registration, so the nominal
  key and the transport key cannot drift. Same-shape sibling Errors therefore
  narrow in both branches of `errorIs`/`matches`/`match` in the generated
  program, and the emitted JavaScript is byte-identical to the unbranded output
  because both the interface and the import specifier are type-only
  (`nominal-errors.test.ts` proves both directions). TypeScript requires an
  inherited brand to be identical, so exactly one level of an inheritance chain
  is branded: a class extending another Error class inherits its ancestor's
  brand rather than declaring a conflicting one, and a generic Error class is
  left unbranded because the merged interface would have to restate its type
  parameter list.
- Ordinary JavaScript `try/catch` keeps JavaScript throw behavior. Uncaught
  recoverable exits lower to Results. `panic(...)` and postfix `!` propagation
  points inside a `try` with a `catch` clause are rejected (`SMITHERS1205`)
  because their early-return lowering would make the catch path silently dead.
- Module trust is exact: only the declared compiler modules
  `smthrs/context`, `smthrs/provider`, `smithers:exceptions`,
  `smithers:comptime`, and `smithers:flows` are compiler intrinsics. Prefixes
  do not confer trust; every other specifier is an ordinary foreign module.
- Top-level `throw` statements (`SMITHERS1511`) and class `static {}` blocks
  (`SMITHERS1107`) fail closed instead of escaping the checked failure channels.
- Declarations in conditionals (`if (const user = cache.get(id); user !== null)
  { ... }`) are recovered before parsing, because stock TypeScript cannot parse
  the form at all. The construct is rewritten into the equivalent scoped shape
  `{ const user = cache.get(id); if (user !== null) { ... } }`: the synthetic
  block opens before the `if` and closes after the last `else` branch, so the
  binding is scoped to the conditional construct and to nothing after it. The
  declaration text, the condition, and every branch stay verbatim, so they keep
  character-exact source-map provenance; only the three glue fragments are
  unmapped. The moved declaration is an ordinary statement, so postfix `!`
  in a conditional declaration lowers through the existing statement-safe path.
  Provisional semantics, POC evidence rather than a locked decision: the binding
  IS visible in `else`/`else if` branches, matching Go's
  `if v := f(); cond { } else { }` and the only scoping the block rewrite can
  prove. Nested `else if (const ...)` chains compose by re-running the pass.
  Shapes whose scope is not provable are refused (`SMITHERS1717`) and left byte
  identical; a reference to the binding *after* the construct is left to the
  acceptance rule, where the generated program reports the unresolved name.
- Runtime helper aliases avoid collisions with authored identifiers. Plain
  TypeScript requiring no transform remains byte-for-byte unchanged.
- Every static module-graph edge shares one specifier-rewrite and
  import-attribute policy: `import`, `export ... from`, and a literal
  `import("./a.json", { with: { ... } })` all move to the generated asset
  module and all lose their attributes on a JavaScript target. A binding a
  `.sm` module re-exports from a generated asset module resolves through that
  re-export instead of failing closed. Deferred dynamic forms stay authored: a
  non-literal specifier, or a literal specifier whose options object the
  compiler cannot evaluate, is never repointed at a generated module. Module
  initialization trust (`SMITHERS1510`) already covers re-export edges, so an
  untrusted generated module cannot enter the graph through one. The lowered
  graph is proven by execution, not only by text: `project.test.ts` writes the
  emitted modules plus the generated asset module to disk, stock-checks the set
  (a re-export specifier left authored would be `TS2307`), and runs the entry
  under a real Node loader (a surviving `with { ... }` bag would be
  `ERR_IMPORT_ATTRIBUTE_*`).
- Relative imports are rewritten when the output moves, generated TypeScript
  is stock-checkable, and source maps embed the original source. Unchanged code
  has exact UTF-16 line/column identity mappings. Changed output starts from
  TypeScript-printer AST/original-node provenance and extends a mapping only
  across text proven identical to the authored source; return/throw lifting,
  multiline propagation operands, cleanup expressions, and import rewrite token
  starts retain conservative attribution. Helper headers, temporaries,
  wrappers, and other compiler-only text are explicitly unmapped rather than
  inheriting a misleading nearest line. Composition preserves unmapped stops,
  cross-file sources/content, and comptime-style multi-source mappings.

Historical `error`, `throws`, named `uses`, `!T`, `?T`, prefix `try`, postfix
`catch`, `orelse`, `.unwrap()`, TypeScript non-null/definite-assignment assertions,
`.?`, `defer`, `errdefer`, value-carrying labeled breaks,
loop `else`, expression-position `if`/`switch`, and labeled block/loop values
are retired and receive migration
diagnostics (`SMITHERS1001`); a retired form the sweep does not claim survives
as the grammar rule `SMITHERS1000`. Recognition is a **grammar** property, not
token adjacency: each retired operator must have the operands its shape
requires — a right operand for prefix `try`, both operands for postfix `catch`
and `orelse`, an identifier operand for a `throws`/`uses` clause suffixed to a
complete return type — and a word used as a property name is never the
operator. `{ try: doThing, catch: handleIt }`, `{ orelse: 7 }`,
`class A { catch() {} }`, `Array<uses>`, and `{ ok: !failed }` are ordinary
code. Ordinary labels, switches, ternaries, `using` declarations, and boolean
negation are pinned as near misses so the retirement sweep cannot over-correct.

`SMITHERS1000` also owns the switch clause separator. Switch clauses are
colon-delimited exactly as in TypeScript and there is no arrow-arm switch
grammar, in expression or statement position, so `case x => v`, `default => v`,
and a clause with no separator at all (`case x v`) are all rejected. TypeScript's
parser recovers each of them by pretending the colon was written, leaving a
clause textually identical to `case x: v` in the tree. The rule therefore
re-reads the gap between each clause header
and its first statement with a scanner: the first significant token there must be
`:`. Only that first token counts, which is what keeps `case x: (() => v)()`,
`case x /* => */: v`, `case flag ? a : b: v`, and `case x as string: v` ordinary
code.

## Honest deferred boundary

This is still a POC, not a sound whole-program compiler:

- Project analysis, lowering, stock checking, and declaration emit are no-write
  in-memory APIs. Filesystem/CLI orchestration, tsconfig paths/project
  references, package resolution for `.sm`, editor integration, and an
  incremental graph remain future work. Every source module must be supplied
  on each call. Declaration `@smithersEffects` metadata is a strict versioned POC
  carrier, not the chosen long-term type-system encoding.
- Conditional declarations are recovered only for `if`. `while`, `for`, and
  `switch` headers keep no declaration form, braceless branches are refused
  rather than scoped by guesswork, and `else`-visibility of the binding is a
  provisional decision the block rewrite happens to be able to prove — not a
  ratified language rule.
- Cross-module propagation is deliberately limited to checker-resolved direct
  static calls, and so is row-template instantiation. Higher-order function
  escapes stay diagnostics; a row variable still deferred at the call site, or a
  template with no spelled `Result` contract, stays fail-closed. Instantiation
  inherits the checker's own assignability, which is structural for authored
  Error classes; the `SMITHERS1806` nominal coverage gate closes the callback case
  that matters, but it is a bounded gate, not a nominal type system.
- Foreign provenance is bounded declaration/data flow, not arbitrary heap
  taint. Immutable local aliases and literal storage are followed; mutable or
  opaque stores, raw accessor/destructuring paths, executable values returned
  through local APIs, nested calls before checked propagation, and callback escape
  are rejected with `SMITHERS1504`/`SMITHERS1506`-`SMITHERS1509`. A future interop IR can
  replace those gates with order- and ownership-preserving lowering.
- Layer inference recognizes the concrete built-ins above. Layer acquisition
  failures, opaque/generic layers, scoped ownership, and general cross-module
  provider graphs are not modeled. A fallible `Layer.provide` callback must
  expose an explicit Result contract so its channel remains visible.
- Must-consume checking is checker-backed but deliberately conservative, not a
  path-sensitive ownership analysis.
- Postfix `!` lowering supports only statement-safe placements. Repeated loop headers,
  generators, and evaluation-order-sensitive expression positions remain
  diagnostics until a production checked IR can represent them.
- Error match syntax is static object-literal cases only, and stable IDs are
  module/name based. Module qualification uses the project-relative source path,
  so moving or renaming a module changes both its row IDs and its runtime
  registration IDs; package-relative or content-addressed identities, codec and
  version evolution, and cross-realm transport belong to the runtime/build
  roadmap.
- Source maps are high-resolution but deliberately incomplete: a transformed
  token without provable AST provenance stays unmapped, rewritten tokens only
  receive a semantic start anchor where column equivalence is not true, and
  names/scopes are not encoded. Generation is capped at 1,000,000 UTF-16 units
  and 16 MiB per map; ambiguous multi-source composition fails closed unless
  the intermediate file is uniquely identifiable. The POC obtains original
  node ranges through `typescript-js` printer hooks that are runtime-exposed
  but not part of its public typings; a production compiler must pin and test
  that emitter integration or replace it with an owned writer. Production
  debugger support still needs end-to-end runtime stack validation and richer
  scope metadata.

These gaps should stay diagnostics or explicit integration constraints until a
real typed control-flow and module graph replaces this transformer.
