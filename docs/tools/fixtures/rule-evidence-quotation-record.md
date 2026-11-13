# Compiler and tooling

**Status:** accepted.

## Will's words

**2026-11-12: one code path.**

1. After reading a report on pluggable VibeLang:

   > "A separate experimental content mapper projects .vibe into TypeScript for stock checking, but lang does not use that path. we don't want this. We want only one code path. content mapper would be ideal. But I don't know if it's 100% viable. Have a fable agent investigate this and decide if we can use content mappers. If we can't use content mappers we likely want as much as possible as content mappers."

2. While discussing why stock `tsc` writes no `.js` for a mapped file:

   > "The content mapper returns typescript. Typesscript compiles that to javascript. That's literally how it's supposed to work what am I missing?"

   > "so what is blocking us from replacing vue's own compiler with tsc?"

   He was shown this diagram:

   ```text
   x.vibe --> our translator --> x.ts (generated file) --> stock tsc --> x.js   (this is what runs)
         \
          --> content mapper (same translator) --> tsc checks it, powers the editor
   ```

   He answered:

   > "Ok I think you get it this is how vibe should work"

3. After learning that Volar v3 hands type checking to content mappers and would add a second editor server:

   > "sounds like forking is actually cleaner than volar but we should better utilize content mappers"

4. He asked:

   > "did you just say we have 2 implementations instead of just turning vibe into typescript?"

   The answer was yes: the fork parsed `.vibe` directly into compiler trees with its own checker hooks and type-directed lowering, producing no TypeScript text; the projection that produced TypeScript text was experimental and stale.

5. He then said:

   > "jesus fix that"

**2026-11-13: removing type-dependent code generation.**

He was asked whether `match` exhaustiveness should lower to a generic test plus `$noMatch` instead of the checker-proven `$assertMatch` last arm, with an `Inline` example and the explanation that both shapes run the same.

> "yea that was an unnecessary transformation. Is there any other place we use types to generate code like this?"

Recorder's reading (not Will's words): this approves emitting the generic `if` plus `$noMatch` and dropping the `$assertMatch` last-arm form.

He was then shown a list of six other places where types affect code generation:

- An `Effect.sync` shortcut and temporaries.
- A call on an `any` receiver.
- Shadowing of `Effect` globals detected from the current file only.
- `Option`, `Exit`, and `Result` recognized only from a direct `effect` import.
- Changing `when Name(x)` to test `instanceof` unless `Name` has its own matcher, moving a plain-function test into a guard and making the old form a compile error.
- Choosing schema codecs by the name as written, with `import type { LibraryDate as Native }` and `export schema S = Native` as the example.

He was told that the last two rows change what programs do and that the schema codec row makes code that compiles today stop compiling. He answered the list as a whole:

> "Yea all this can be removed"

Recorder's reading (not Will's words): this approves removing the other type-dependent code generation so the translator decides from the file as written. The six rows came from a design document and had not been checked against the compiler source in that exchange; only the schema codec row was shown with its own code example.

