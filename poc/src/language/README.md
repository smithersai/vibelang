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
- `SMITHERS1205`: a `panic(...)`, `Result.unwrap()`, or `Optional.unwrap()`
  propagation point sits lexically inside a JavaScript `try` with a `catch`
  clause; its early-return lowering would silently bypass the catch handler.
- `SMITHERS1206`: `Optional.unwrap()` has no enclosing `Optional`-returning (or
  `Result<Optional>`-returning) function that can propagate absence.
- `SMITHERS1511`: a top-level `throw` statement cannot be represented as a checked
  Result (mirrors the `SMITHERS1505` top-level panic rule; `SMITHERS1505` also covers
  top-level `Result.expect()`).

- `SMITHERS1801`: a relative `.sm` import is absent from the supplied project;
  `SMITHERS1804`: a named/default import is not an exported value in that module.
- `SMITHERS1802`: a cross-module function escapes direct static-call analysis.
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
  boundary without an explicit Result contract.
- `SMITHERS1404`: an async callback has no compiler-recognized owner. The rule is
  over *started* work, so the recognized owners are `Result.tryPromise`, a
  consumed `Layer.provide`, and the `smithers:native` pin — `native(fn)` receives
  a function reference, asserts over its transitive graph, and returns it without
  invoking it, so it starts no Promise and an async subject is accepted. The pin
  is recognized by prelude symbol identity, so a locally declared `native` owns
  nothing and keeps the general rule.
- `SMITHERS2105`: a fallible `Layer.provide` callback needs an explicit Result or
  `Promise<Result>` contract.
- `SMITHERS1504`: a foreign constructor is not lowerable unless its resolved
  constructor declares `@throws {never}`; `SMITHERS1505`: a checked foreign panic
  channel appears at top level.
- `SMITHERS1506`: a foreign property/accessor read needs an annotated adapter;
  `SMITHERS1507`: a foreign factory/result is invoked before an expression-safe
  unwrap/local binding.
- `SMITHERS1508`: executable foreign provenance escapes through an unsupported
  higher-order/return/store boundary; `SMITHERS1509`: a callback may escape into
  foreign code outside the checked call scope.
- `SMITHERS1510`: a statically loaded TypeScript/JavaScript module lacks a leading
  JSDoc module-initialization trust claim containing both `@module` and
  `@throws {never}`. Type-only imports and compiler intrinsics are exempt.
- `SMITHERS1710`: a `defer`/`errdefer` marker has unsupported placement or no
  parser-recoverable cleanup expression; `SMITHERS1711`: `errdefer` has no Result
  owner whose emitted error variant can be inspected.
- `SMITHERS1712`: cleanup may panic, unwrap, produce a Result/Promise, or otherwise
  has ambiguous failure composition; `SMITHERS1713`: an async `errdefer` tail
  directly returns a Promise before its Result can be inspected.
- `SMITHERS1705`: a recovered value-producing `if`/`switch` lacks a required value
  branch/default; `SMITHERS1706`: its case label or authored jump would make the
  checked evaluation order or value join unsafe.
- `SMITHERS1707`: a value `if`/`switch` expression sits in a placement whose
  checked evaluation order cannot be preserved by hoisting (short-circuit
  right sides, conditional branches, loop headers, spreads evaluated earlier,
  compound assignments, update expressions, optional chains, computed names,
  defer cleanups, statements whose earlier declarators are effectful or whose
  declared names a hoisted unit references, braceless single-statement
  branches, template/tagged-template spans, and recovery bound overflows).
- `SMITHERS1708`: the callee evaluated ahead of a recovered value expression
  cannot be proven order-stable. Callees stay in place so `this` binding and
  direct static-call analysis survive, which is only sound for identifiers
  never written in the module and single-level members whose declarations are
  methods/functions/readonly properties/const bindings with no member write
  anywhere in the module.
- `SMITHERS1709`: a value `if` expression in a general expression position has a
  braceless branch; the recovered extent of a braceless branch is not provable
  in expression context, so general placements require braced branches.
- `SMITHERS1714`: a labeled block value construct is malformed or unsafe: a
  `break :label` without a delimitable value, a label shadowed inside its own
  block, a statement-position labeled block containing value breaks, a value
  break inside a nested function, a plain `break label` or escaping jump that
  would complete the block without its value, or a block that may complete
  normally without reaching any `break :label value`.
- `SMITHERS1715`: a labeled loop value construct is malformed or unsafe: a
  braced-body value loop without an `else` completion value, an undelimitable
  break or else value, a statement-position value loop, a value break inside
  a nested function, or a jump escaping the loop construct. Cross-construct
  value breaks (`break :outer` from inside another value construct) are
  rejected through the same escape rule because nested label selection is not
  finalized in the specification.
- `SMITHERS1717`: a conditional declaration
  (`if (const user = cache.get(id); user !== null) { ... }`) has a shape whose
  binding scope is not textually provable: a braceless branch anywhere in the
  `if`/`else if`/`else` chain, `var` (which hoists out of the construct), a
  header without exactly one depth-1 `;`, an empty declaration or condition, or
  an unbalanced chain.
- `SMITHERS1716`: an expression switch over a checker-known closed literal union
  (string/number/boolean literal members, including literal enum members by
  value, matching `===` selection semantics) is missing members and has no
  default, or its non-literal case labels keep coverage unprovable. A proven
  fully-covered closed-union expression switch no longer needs a default
  clause; open scrutinee types keep the `SMITHERS1705` default requirement.

The CLI has the same acceptance rule and does not write output on either class
of error:

```sh
bun poc/src/language/cli.ts \
  poc/examples/language/demo.sm \
  poc/examples/language/demo.generated.ts
bun poc/examples/language/demo.generated.ts
bun test poc/src/language/
```

The expression-oriented control-flow suites live beside the frontend:
`control-flow.test.ts` (bounded hosts), `expression-placement.test.ts`
(general placement recovery), `labeled-values.test.ts`, `loop-values.test.ts`,
and `switch-exhaustiveness.test.ts`; `examples/language/expression-flow.sm`
is the executable example. `generic-rows.test.ts` covers polymorphic
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
  throws, calls, checked `panic`, foreign boundaries, and `Result.unwrap()`.
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
- Public fallible functions require explicit `Result<A, E>` contracts. Returns
  and throws lower to explicit Result constructors, and unwrap lowers to an
  inspected early `return` of the same error.
- `Optional<T>` and `Result<Optional<T>, E>` returns lift in the specified
  outside-in order. `Optional.unwrap()` lowers to an inspected early return of
  the absent value (`none`, or `success(none)` in a `Result<Optional>` owner)
  in the same statement-safe placements Result unwrap supports; without an
  Optional-capable owner it is rejected (`SMITHERS1206`) instead of silently
  compiling to the runtime's missed-lowering throw.
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
- Imported TypeScript/JavaScript runtime values retain checker-declaration
  provenance through namespace selection, local aliases, immutable object/array
  storage, methods, and explicitly unwrapped factory results. Supported calls
  become `Result.try`/`tryPromise` with `Panic`; checker-resolved `@throws
  {never}` is trusted, while `@throws {SomeError}` validates the foreign value
  and exposes `SomeError | Panic` so a violated contract remains `Panic`.
- Foreign module evaluation is checked separately from calls because an ESM
  initializer can fail before any Result boundary exists. Static foreign
  modules fail closed unless their leading JSDoc contains both `@module` and
  `@throws {never}`; that module tag never doubles as a function-level opt-out.
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
  recoverable exits lower to Results. `panic(...)` and unwrap propagation
  points inside a `try` with a `catch` clause are rejected (`SMITHERS1205`)
  because their early-return lowering would make the catch path silently dead.
- Module trust is exact: only the declared compiler modules
  `smthrs/context`, `smthrs/provider`, `smithers:exceptions`,
  `smithers:comptime`, and `smithers:flows` are compiler intrinsics. Prefixes
  do not confer trust; every other specifier is an ordinary foreign module.
- Top-level `throw` statements (`SMITHERS1511`) and class `static {}` blocks
  (`SMITHERS1107`) fail closed instead of escaping the checked failure channels.
- Parser-recovered, bare `defer expression` and `errdefer expression` markers
  are paired only as direct statements in a braced block, with the cleanup on
  the same statement line. The remaining lexical tail becomes nested
  `try/finally`: registration occurs only after control reaches the marker,
  `defer` runs for fallthrough, return, break/continue, and JavaScript throw,
  and later registrations run first. `errdefer` instruments already-lowered
  Result returns and runs only when the emitted value is the error variant,
  including recoverable `throw` and `Result.unwrap()` propagation. Nested
  function bodies are separate owners. Async owners accept exactly one root
  `await` of a plain cleanup Promise. This ordering and syntax recovery are POC
  evidence, not a normative language decision.
- Function bodies in `if`, `switch`, `try`, and ordinary loop statements are
  recursively lowered. In variable initializers and same-line returns, bounded
  nested `if`/`switch` expressions lower through typed join temporaries;
  Result exits, branch-local nominal types, fallthrough, unsafe case labels,
  and escaping jumps are checked conservatively. Repeated loop-header unwrap
  is explicitly rejected.
- Braced-branch `if`/`switch` expressions are additionally accepted in general
  expression placements: call/new arguments, array elements and construct
  spread operands, object property values (with shorthand and pure earlier
  members), nested initializer expressions and non-short-circuit binary
  operands, plain identifier assignments' right sides, element receivers and
  indices, `return`/`throw`/condition/discriminant positions, and arrow
  concise bodies. A pre-parse pass proves each construct's extent through the
  parser's own recovery shape, masks it to obtain a clean containing-statement
  AST, and hoists the construct plus every impure earlier operand into
  compiler temporaries before the statement, preserving authored evaluation
  order; the hoisted form is the bounded initializer host the join planner
  already checks, so typed joins and Result/Optional exits behave identically.
  Callees are left in place under a checker-verified stability proof
  (`SMITHERS1708` on failure); order-unpreservable placements are rejected
  (`SMITHERS1707`, `SMITHERS1709`) and everything else keeps `SMITHERS1702`. Diagnostics
  and analysis spans are reported in authored coordinates, and source maps
  compose the printer map with an exact derived-to-authored offset map so
  moved text keeps character-exact provenance while compiler glue stays
  unmapped. A construct keyword after `case x:` or a label is now proven to be
  an ordinary statement instead of misreported as an expression.
- Labeled block values (`const x = label: { ...; break :label value; ... }`)
  are recovered by rewriting each `break :label value` into the parseable
  `{ value; break label; }` form and placing the labeled statement before a
  marker-initialized host declaration, in the bounded hosts and every general
  placement above. Only pre-parse-recovered constructs are claimed - authored
  ternary/object colons and ordinary labeled statements are never
  reinterpreted, and recognition requires at least one `break :label value`.
  The lowering assigns a typed join temporary at every site and keeps
  ordinary TypeScript labeled-break semantics, so unwraps and Result exits
  inside the block lower exactly as in statement position. When a nested
  construct makes the analysis-program join `any`-tainted, the temporary is
  left unannotated and the emitted program's own control-flow inference
  supplies the precise union. Every reachable exit must carry a value
  (`SMITHERS1714` otherwise).
- Loop expression values (`const x = search: for (...) { ... break :search v
  ... } else fallback`, and the `while` form) wrap the authored labeled loop
  in a compiler-labeled block whose second statement holds the `else`
  completion value. Value breaks target the wrapper (skipping the else);
  plain `break search`, `continue`, and normal loop completion flow into the
  else value, which is always required. Runtime-sized loops remain ordinary
  runtime loops - nothing unrolls. The else value ends at `;`, a line break
  after an expression-ending token, or an enclosing comma/bracket, so the
  construct composes with argument lists and literals.
- Declarations in conditionals (`if (const user = cache.get(id); user !== null)
  { ... }`) are recovered before parsing, because stock TypeScript cannot parse
  the form at all. The construct is rewritten into the equivalent scoped shape
  `{ const user = cache.get(id); if (user !== null) { ... } }`: the synthetic
  block opens before the `if` and closes after the last `else` branch, so the
  binding is scoped to the conditional construct and to nothing after it. The
  declaration text, the condition, and every branch stay verbatim, so they keep
  character-exact source-map provenance; only the three glue fragments are
  unmapped. The moved declaration is an ordinary statement, so `Result.unwrap()`
  in a conditional declaration lowers through the existing statement-safe path.
  Provisional semantics, POC evidence rather than a locked decision: the binding
  IS visible in `else`/`else if` branches, matching Go's
  `if v := f(); cond { } else { }` and the only scoping the block rewrite can
  prove. Nested `else if (const ...)` chains compose by re-running the pass.
  Shapes whose scope is not provable are refused (`SMITHERS1717`) and left byte
  identical; a reference to the binding *after* the construct is left to the
  acceptance rule, where the generated program reports the unresolved name.
- Expression switches over closed literal unions are checked for
  exhaustiveness: full literal coverage removes the default-clause
  requirement, missing members are named in `SMITHERS1716`, and proven-exhaustive
  lowered switches never receive an unreachable implicit completion. Plain
  unlabeled `while`/`for` in expression position stays fail-closed
  (`SMITHERS1702`): the specification defines loop values only through labeled
  break values and the loop `else`, so an unlabeled loop expression has no
  defined value-producing exits.
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
  multiline unwrap operands, cleanup expressions, and import rewrite token
  starts retain conservative attribution. Helper headers, temporaries,
  wrappers, and other compiler-only text are explicitly unmapped rather than
  inheriting a misleading nearest line. Composition preserves unmapped stops,
  cross-file sources/content, and comptime-style multi-source mappings.

Historical `error`, `throws`, named `uses`, `!T`, `?T`, prefix `try`, postfix
`catch`, `orelse`, and `.?` spellings are retired and receive migration
diagnostics (`SMITHERS1001`); a retired form the sweep does not claim survives
as the grammar rule `SMITHERS1000`. Recognition is a **grammar** property, not
token adjacency: each retired operator must have the operands its shape
requires — a right operand for prefix `try`, both operands for postfix `catch`
and `orelse`, an identifier operand for a `throws`/`uses` clause suffixed to a
complete return type — and a word used as a property name is never the
operator. `{ try: doThing, catch: handleIt }`, `{ orelse: 7 }`,
`class A { catch() {} }`, `Array<uses>`, and `{ ok: !failed }` are ordinary
code. Unsupported expression placements (short-circuit right sides,
conditional branches, loop headers, nested assignments, multi-declarator
initializers past the first, template spans, and the other `SMITHERS1707`/
`SMITHERS1702` shapes), unlabeled loop expressions, cross-construct value breaks,
and unsafe defer shapes fail closed instead of receiving a source-text
approximation.

`SMITHERS1000` also owns the switch clause separator. Switch clauses are
colon-delimited exactly as in TypeScript and there is no arrow-arm switch
grammar, in expression or statement position, so `case x => v`, `default => v`,
and a clause with no separator at all (`case x v`) are all rejected. TypeScript's
parser recovers each of them by pretending the colon was written, leaving a
clause textually identical to `case x: v` in the tree, and its own
"':' expected" is suppressed as parse noise within 48 characters of a recovered
`switch` expression host — which made acceptance depend on the DISTANCE from the
`switch` keyword. The rule therefore re-reads the gap between each clause header
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
  through local APIs, nested calls before checked unwrap, and callback escape
  are rejected with `SMITHERS1504`/`SMITHERS1506`-`SMITHERS1509`. A future interop IR can
  replace those gates with order- and ownership-preserving lowering.
- Layer inference recognizes the concrete built-ins above. Layer acquisition
  failures, opaque/generic layers, scoped ownership, and general cross-module
  provider graphs are not modeled. A fallible `Layer.provide` callback must
  expose an explicit Result contract so its channel remains visible.
- Must-consume checking is checker-backed but deliberately conservative, not a
  path-sensitive ownership analysis.
- Unwrap lowering supports statement-safe placements. The `if`/`switch` join
  planner covers the bounded hosts plus the recovered general placements, and
  labeled block/loop values and closed-union exhaustiveness are implemented
  through the same pre-parse recovery; repeated loop headers, generators,
  unlabeled loop expressions, nested label selection across constructs, and
  the remaining `SMITHERS1702`/`SMITHERS1707` placements still require the production
  checked IR. The pre-parse recovery is a bounded textual transform (256
  constructs, 32 edit rounds per module) whose evaluation-order proofs are
  deliberately conservative; callee stability rests on declaration shape plus
  a whole-module write scan, not aliasing analysis.
- Defer is deliberately narrower than a final control-flow IR: markers outside
  direct braced statement lists, newline-separated or missing/non-expression
  cleanup, cleanup that can panic/unwrap/return Result or an unowned Promise,
  and async `errdefer` tails returning an unawaited Promise are diagnostics.
  Cleanup-error composition is not defined. Only a root awaited plain Promise
  cleanup is accepted in async owners, and the provisional nested-finally LIFO
  behavior must not be treated as a locked ordering decision.
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
