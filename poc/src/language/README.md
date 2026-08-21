# Language risk spike

This directory is intentionally a compiler-shaped experiment, not a second
specification. It proves the current source model can remain eager TypeScript
while a separate analysis pass carries failure and requirement rows.

Run the current-spec demo from the repository root:

```sh
bun poc/src/language/cli.ts \
  poc/examples/language/demo.vibe \
  poc/examples/language/demo.generated.ts
bun poc/examples/language/demo.generated.ts
bun test poc/src/language/language.test.ts
```

The spike implements:

- token-aware recognition of `error`, `!T`, `throws`, named `uses`, `try`, and
  typed catch expressions;
- fixed-point failure/requirement inference over direct function calls;
- exported-row checks, naked-failing-call checks, exhaustive catch checks, and
  syntactic `Layer.provide` closure checks;
- branded failure classes and sync/async failure-only catch behavior;
- nominal layers with nested override and `AsyncLocalStorage` scoping;
- simple `?T`, `orelse`, `.?`, throw expressions, and expression-arm `if`;
- the locked `any`/`eval` => `TypeScript` classification and rejection of
  ambient host globals in authored functions.

Recognized but deliberately rejected with diagnostics: payload-capturing
optionals, compound optional types, block/switch/loop expressions, `defer`, and
`errdefer`. Those need typed control-flow IR rather than another source rewrite.

The analyzer is syntactic: aliases, methods, higher-order calls, generic row
polymorphism, layer acquisition failures, source maps, and editor integration
are outside this spike. Replacing its call resolution with the real TypeScript
checker while preserving the row fixed point is the intended next step.

The scanner deliberately handles a few TypeScript-superset collision cases
(`uses`/`throws` type aliases, object return types, property names, local host
names, and both JavaScript catch forms), and plain TypeScript that needs no
lowering is emitted byte-for-byte. This is a regression fence, not a parser
claim: overloads, destructured/shadowed bindings, nested lexical scopes,
cross-module symbols, generic calls, and full expression precedence remain
illustrative until the upstream TypeScript parser/checker owns the syntax.
