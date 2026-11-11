# VIP-14: Effect's modules are in scope without an import

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
const Port = Schema.Number                       // Effect's Schema, no import
effect function pause() { try sleep(Duration.seconds(1)) }   // try runs in effect code (VIP-26)
const first = Effect.Array.head([1, 2])          // Effect's Array module: JavaScript's Array wins the bare name
const o = Option.some(1)                         // Effect's Option: the DOM's Option is platform-specific
```

- Every root export of the core `effect` package (149 in effect 4.1.1, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import. Emitted code imports each module it uses from `effect/<Module>`.
- This is configurable in `tsconfig.json`, as VIP-6's globals are.
- **Precedence by default.** JavaScript globals that aren't platform-specific, and TypeScript's own globals, keep their meaning. Effect's module of the same name is then reachable as `Effect.X`, or by import.

  | Name | Bare name means | Effect's module |
  | --- | --- | --- |
  | `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |
  | `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |
  | `Request`, `Option`, `Cache`, `FileSystem`, `Scheduler`, `Console` (platform-specific) | Effect's module | the bare name |
- **Amended 2026-10-29: no `Crypto` row.** effect 4.1.1 has no root `Crypto` module, so bare `Crypto` is the DOM's. Proposed to Will on 2026-10-29; accepted without objection.
- **Amended 2026-10-29: names two subpaths export.** A namespace name that two subpaths export, or a subpath and the root, is not in scope bare. Using it is a compile error that names every exporter and offers one import per exporter: in 4.1.1, `Model`, `Prompt` and `Utils`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 55).

## History

One minor finding, "unclassified globals", resolved. No other findings.

## Prior art

Rust's prelude; Elixir's `Kernel`; VIP-6.

## Will's words

> "So like before this should be configurable in the tsconfig.json but by default we should make javascript globals that are not platform specific take president but we should also make them available on Effect.* not just via impport with those changes I accept"

> "Yea Typescript globals like Record take president"

- **Amended 2026-11-01: collision qualifiers use the implicit binding.** `Effect.Array`, `Effect.String`, `Effect.Record` and other colliding-module qualifiers are intrinsic to the compiler's implicit `Effect`; they are not exports of `effect/Effect`. A written binding, imported under any name or declared locally, keeps its TypeScript meaning and shadows the implicit binding. An explicit namespace has no `Array` member (`TS2339`); use `import { Array as Arr } from "effect"`. Turning `vibe.effectModules` off removes the implicit qualifier without changing explicit imports.
- **Clarified 2026-11-11: which `Effect.M` names a module.** Through the implicit `Effect`, `Effect.M` names a module only when `M` is in the precedence table's first two rows: `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp`, `Record` and `Iterable`. Emitted code imports that module from `effect/<M>` under a fresh name, so `Effect.Array.head` is `effect/Array`'s `head`. Every other `Effect.x` is the export `x` of `effect/Effect`: `Effect.Option`, `Effect.Schema` and `Effect.Nothing` are TypeScript's `TS2339` (`TS2551` where TypeScript suggests a near name), and the bare `Option` and `Schema` are the modules. [Effect's modules are in scope](../src/005-services.md#effects-modules-are-in-scope) states this rule; the amendment above named only its examples.
- **Clarified 2026-11-11: subpath namespaces are in scope too.** The root exports are not the whole set. [VIP-33](0033-platform-stdlib.md)'s rule 3 also puts in scope the namespaces of effect 4.1.1's 23 lowercase subpaths, such as `effect/ai`, `effect/http` and `effect/testing`, with this VIP's precedence. Bare `LanguageModel` is `effect/ai`'s and emits `import * as LanguageModel from "effect/ai/LanguageModel"`; bare `TestClock` is `effect/testing`'s; neither is a root export. A name that two subpaths export, or a subpath and the root, stays `EK1401`, as the 2026-10-29 amendment above rules. [The platform standard library](../src/005-services.md#the-platform-standard-library) lists the 23 subpaths.

*Corrected 2026-11-11: the Decision example runs `sleep` inside an `effect` function and passes `Effect.Array.head` an array. A module's top level is not effect code, so a `try` there is `EK0501` (VIP-26), and the example's `xs` was never declared.*
