# VIP-6: Effect's functions are globals

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
effect function load(q) {
  const r = try tryPromise((signal) => queryDb(q, { signal }))   // Effect.tryPromise
  const n = try sync(() => Date.now())                           // Effect.sync
  try retry(tryPromise(() => queryDb(q)), policy)
  try sleep("1 second")
  const d = try Effect.try(() => JSON.parse(s))                  // `try` is a reserved word, so it stays Effect.try
}
```

- Every export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, and so on. A local declaration or import shadows one, as with any global.
- An option in `tsconfig.json` turns the globals off (VIP-14: "like before this should be configurable in the tsconfig.json").
- A name that clashes is not a global, and is used as `Effect.x` instead. A name clashes if it is:
  - a reserved word: `try`, `catch`, `void`, `let`;
  - a JavaScript global: `undefined`;
  - a VibeLang keyword.
- If a later VIP adds a keyword with the same name as an Effect export, the global is removed. That may happen to `match`, `when`, `service` and `provide`.
- No language feature wraps TypeScript into an Effect. You use Effect's own functions (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TS.

*Corrected 2026-10-29: the example calls `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*

## Prior art

Rust's prelude, Elixir's `Kernel`, Kotlin's top-level `launch` and `delay`, Python's builtins.

## Will's words

> "We should have a VIP regarding global variables where we make Effect.* global meaning we don't even need a language feature it can just be existing effect syntax for wrapping typescript"

> "Ok these are global varaibles. There should be a config option to turn off globals. Anything that clashes must be accessed via Effect.* instead of globally if it clashes with either a javascript global or it clashes with a keyword we end up adding. If we add the keyword in future we will also remove it (like in case of provide and service)"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


- D151's hand-picked list of prefix-free functions, widened here to every `Effect` export.
- D148's hatches (`sync`, `try`, `callback` as special prelude forms) and D229's no-capture rule.

D146, under which `effect`'s modules such as `Stream` and `Schema` are in scope without an import, is untouched; no VIP has decided it.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 309

**Legacy fork options use the native Effect API; the keyword grammar stays small.** (Smithers switch family B; VIP-6/VIP-17/VIP-34; principles1/2/3/4/7; existing65/84/88/99/274.) For the proven legacy current-fiber-child builtin `fork(program, options)`, the preserving VIP-only codemod writes `try Effect.forkChild(program, options)` in its existing Effect context. Resolve the original builtin and native function hygienically. Preserve program/options evaluation, captures, child ownership, interruption and public Fiber/error/environment types. No keyword options tail or comma-expression reinterpretation is added.

    ```vibe
    const call = (n: number) => Effect.succeed(n)
    export effect function start(n: number) {
      return try Effect.forkChild(call(n), { startImmediately: true })
    }
    ```

    **Effect TS:** `const call = (n: number) => Effect.succeed(n); export function start(n: number) { return Effect.gen(function*() { return yield* Effect.forkChild(call(n), { startImmediately: true }) }) }`. Actual installed Effect4.1.0 declares `startImmediately?: boolean` and `uninterruptible?: boolean | "inherit"`; VIP-17 already defines bare `fork` through `Effect.forkChild`. Native interop exposes its options without another language rule. A different original ownership form keeps its separately established native counterpart.

    Creating the operand and options is not automatically moved onto the child. Retain fork/catch ownership and any proven older by-name provenance; refuse unknown semantics. User helpers outside the reserved context follow their resolved bindings, not their spelling. Existing valid keyword forms and callable boundaries retain their meanings.

    These sites are pre-existing `.vibe` tests. Existing272 permits official language-version migration that preserves their assertions, coverage and identities. Pending308 separately asks permission to change two stronger test gates. Owners require failing-before/passing-after regressions and keyed properties for option values/getters, evaluation order, aliases/shadowing, ownership, failure/interruption, contexts, public types and unchanged assertions.

    Evidence: pinned main VIP-17 and `native-fork-options-source-receipt.json`, with verified Effect4.1.0 package version, declaration hash and options signature. This lane inspected the native API; no fork runtime, VibeLang codemod, Go or product gate was executed. The owner's current-main refusal is an implementation gap, not a missing native API or permission for manual test edits.

    Decided by the agent from principles1/2/3/4/7 and accepted VIP-6/VIP-17/VIP-34, 2026-11-02 under the 2026-10-29 delegation. Class A; no new public package API, language syntax or Will question.
