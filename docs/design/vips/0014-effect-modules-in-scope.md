# VIP-14: Effect's modules are in scope without an import

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
const Port = Schema.Number                       // Effect's Schema, no import
try sleep(Duration.seconds(1))
const first = Effect.Array.head(xs)              // Effect's Array module: JavaScript's Array wins the bare name
const o = Option.some(1)                         // Effect's Option: the DOM's Option is platform-specific
```

- Every root export of the core `effect` package (149 in effect 4.1.0, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import. Emitted code imports each module it uses from `effect/<Module>`.
- This is configurable in `tsconfig.json`, as VIP-6's globals are.
- **Precedence by default.** JavaScript globals that aren't platform-specific, and TypeScript's own globals, keep their meaning. Effect's module of the same name is then reachable as `Effect.X`, or by import.

  | Name | Bare name means | Effect's module |
  | --- | --- | --- |
  | `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |
  | `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |
  | `Request`, `Crypto`, `Option`, `Cache`, `FileSystem`, `Scheduler`, `Console` (platform-specific) | Effect's module | the bare name |
- **Amended 2026-10-29: no `Crypto` row.** effect 4.1.0 has no root `Crypto` module, so bare `Crypto` is the DOM's. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: names two subpaths export.** A namespace name that two subpaths export, or a subpath and the root, is not in scope bare. Using it is a compile error that names every exporter and offers one import per exporter: in 4.1.0, `Model`, `Prompt` and `Utils`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 55).

## History

One minor finding, "unclassified globals", resolved. No other findings.

## Prior art

Rust's prelude; Elixir's `Kernel`; VIP-6.

## Will's words

> "So like before this should be configurable in the tsconfig.json but by default we should make javascript globals that are not platform specific take president but we should also make them available on Effect.* not just via impport with those changes I accept"

> "Yea Typescript globals like Record take president"

- **Amended 2026-11-01: collision qualifiers use the implicit binding.** `Effect.Array`, `Effect.String`, `Effect.Record` and other colliding-module qualifiers are intrinsic to the compiler's implicit `Effect`; they are not exports of `effect/Effect`. A written binding, imported under any name or declared locally, keeps its TypeScript meaning and shadows the implicit binding. An explicit namespace has no `Array` member (`TS2339`); use `import { Array as Arr } from "effect"`. Turning `vibe.effectModules` off removes the implicit qualifier without changing explicit imports.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 11

(VIP-14) Drop the `Crypto` row: effect 4.1.0 has no root `Crypto`, so `Crypto` is the DOM's.

### Detail 55

(NW 18; VIP-14, VIP-33) A namespace name that two subpaths export, or a subpath and the root, is not in scope bare. Using it is a compile error that names every exporter and offers one import per exporter. In 4.1.0 this covers `Model` (`effect/ai`, `effect/schema`), `Prompt` (`effect/ai`, `effect/cli`) and `Utils`.
    ```vibe
    Model.make(…)                                   // error: Model is exported by effect/ai and effect/schema
    import { Model } from "effect/ai"               // ok
    ```
    Effect TS: the explicit import. Decided by the agent from principle 3 (no spelling-based priority list) and principle 8; 2026-10-29.

### Detail 76

**Bare `Worker` is Effect's `effect/workers` namespace** (NW 40; all four round-15 reviewers). VIP-14's precedence already resolves bare `Worker` to `effect/workers`, as it resolves `Headers` (`effect/http`), `Response` (`effect/ai`) and `Event` (`effect/eventlog`). Detail 56's `Worker` entry bans the host binding only: `globalThis.Worker`, `globalThis["Worker"]` and `self.Worker` are `EK4402`. A local or imported `Worker` shadows as usual. `new Worker(url)` on the namespace gets TypeScript's own "not constructable" error.
    ```vibe
    Worker.makePool(…)                  // effect/workers
    new globalThis.Worker(url)          // EK4402: use effect/workers
    import { Worker } from "./mine"     // shadows; resolves to ./mine
    ```
    Effect TS: `import { Worker } from "effect/workers"`. Decided by the agent from principle 3 (resolve by binding, not spelling) and VIP-14's precedent for the other three names; 2026-10-29.

### Detail 289

**VIP-14's collision-module qualifier belongs to the implicit Effect binding; a written binding keeps TypeScript's namespace meaning.** (R10 Opus OPUS-5; accepted VIP-14's default precedence/configurability,005's import-shadowing rule; principles2/3/8.) The documented `Effect.M` access to a colliding module such as `Effect.Array` is an intrinsic lookup on the compiler-provided in-scope binding. It is not an additional export or runtime property of `effect/Effect`. Resolve that binding hygienically. A local or imported `Effect` shadows it, and all members of the written binding are then ordinary TypeScript members; do not select the intrinsic from the identifier text.

    In particular `import { Effect } from "effect"` gives the real `effect/Effect` namespace, whose absent `Array` member is native `TS2339`. Use an explicit module import such as `import { Array as Arr } from "effect"`. With `vibe.effectModules: false` the implicit qualifier is absent too; an explicit import does not silently turn it back on. Existing ordinary `Effect` members and local objects' own properties remain unchanged.

    ```vibe
    // implicit.vibe: no written Effect binding
    const first = Effect.Array.head([1, 2]) // VIP-14's hygienic Array module import
    ```

    ```vibe
    // explicit.vibe: an independent file
    import { Effect, Array as Arr } from "effect"
    const first = Arr.head([1, 2])
    const invalid = Effect.Array // TS2339
    ```

    Effect TypeScript counterpart: the first lookup emits a fresh import of `effect/Array` and calls its `head`; the explicit-import file is already ordinary Effect TypeScript. The qualifier is the accepted prelude convenience, not a new reified namespace facade or a change to every alias of the Effect package.

    Qualify005's advice and VIP-14's public amendment, with a valid explicit-import example when the option is off. Test/fuzz implicit versus local/imported bindings, renamed imports, actual module members, collisions and the two option values; assert binding-driven behavior and the native diagnostic. No compiler execution or new API is claimed here.

    Decided by the agent from principle2 (written imports retain TypeScript meaning), principle3 (resolve the provided binding, never its spelling), principle8 (do not add properties to an explicitly imported namespace), and VIP-14's already accepted default/prelude distinction, 2026-11-01, under Will's 2026-10-29 delegation. Class A.
