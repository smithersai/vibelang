# VIP-33: the platform standard library

**Status:** accepted, 2026-10-29: Will's 10-26 rulings, re-presented against VIP-1 to VIP-32 and recorded under his standing approval of recommendations.

## Decision

```ts
effect function readConfig(path: string) {
  const fs = try FileSystem.FileSystem             // Effect's platform service, injected by a layer
  return try fs.readFileString(path)
}
provide NodeServices.layer { try readConfig("app.json") }   // VIP-12; the platform layer is chosen at the edge
```

1. **Platform access only through injected Effect services** (`FileSystem`, `Path`, `ChildProcess`, `HttpClient`, …), each provided by a per-platform layer. A `.vibe` file has no `node:*` value imports and no Node globals (`process`, `Buffer`). Code that needs them lives in a `.ts` file; VIP-25 removed inline modules, so a `.ts` file is the escape.
   - **Amended 2026-10-29: no exception inside `Effect.try` / `tryPromise` arrows.** A platform call there, such as `tryPromise(() => fetch(url))`, is the same error as anywhere in `.vibe`. Its quick fix and the codemod move the body into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`). Recorded under Will's standing approval of recommendations.
2. **What Effect lacks goes under `Experimental.X`**, named after the Effect module it extends, and is written so it can be proposed upstream. No per-project wrappers, and nothing that Effect already provides.
3. **Subpath namespaces are in scope** (`HttpClient`, `FileSystem`, `Path`, `ChildProcess`, … from Effect's subpath packages), with VIP-14's precedence rules.
4. Old VibeLang's alias `Path.join(…)` → `Path.Path.join(…)` (D311) was a service shorthand, which VIP-10 denied. You write `(try Path.Path).join(…)`.
5. Old VibeLang's provisional D312, under which the entry provided NodeServices for `main`, is gone (VIP-26).

*Corrected 2026-10-29: the module `FileSystem` is a namespace, and the service key it exports is `FileSystem.FileSystem` (likewise `Path.Path`); in effect 4.1.0, `yield*` of the namespace is a defect.*

- **Amended 2026-10-29: the banned globals.** A reference in any `.vibe` code to a Node global (`process`, `Buffer`, `global`, `__dirname`, `__filename`, `require`, `module`, `exports`, `setImmediate`, `clearImmediate`), a web I/O or host-state global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `self`, `Worker`, `SharedWorker`, `BroadcastChannel`, `postMessage`, `alert`, `confirm`, `prompt`, `crypto`, `performance`), `console` or a timer (`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`) is a compile error whose quick fix names the Effect service or moves the code to a `.ts` file. ECMA-262 globals and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `Intl`) stay allowed. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 56).
- **Amended 2026-10-29: the banned globals are derived, not listed.** A value reference in `.vibe` code is `EK4402` when the symbol it resolves to is declared in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, not in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist. A local binding, an import or an Effect module in scope shadows the global first. The allowlist is closed: the data utilities above plus `AbortSignal`, which Effect passes to `Effect.tryPromise` callbacks; `AbortSignal.timeout` stays banned. The set is generated into `docs/design/inventory/platform-globals.json`. This replaces the enumerated list above, whose names keep their quick fixes. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 101).
- **Amended 2026-10-29: `globalThis` and `import()`.** `globalThis` may appear in `.vibe` code only as the object of a statically named member access. A banned platform member is `EK4402`; `eval` and `Function` follow [VIP-1](0001-effect-and-async-functions.md), including its `Function` exemptions for the right operand of `instanceof` and a statically named `prototype` access. Every other use of `globalThis` is `EK0107`. `import(expr)` with a computed specifier stays unchecked; a string-literal `data:` or `blob:` specifier is `EK0107`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 73 and 74).
- **Amended 2026-10-29: bare `Worker`.** Bare `Worker` is Effect's `effect/workers` namespace, as `Headers`, `Response` and `Event` are Effect's; the banned `Worker` entry covers the host binding only (`globalThis.Worker`, `self.Worker`). Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 76).
- **Amended 2026-10-29: `import.meta` is limited to `import.meta.url`.** In `.vibe` code `import.meta` may appear only as the object of `.url`. Every other member (`dirname`, `filename`, `env`, `main`, `resolve`, host additions) and every other use of `import.meta` (an alias, destructuring, a computed key, an argument, a spread) is `EK4402`; a type position is TypeScript's. The quick fix names the Effect service (`Path`, `Config.String`) or moves the code to a `.ts` file. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 90).
- **Amended 2026-10-30: one rule for platform members.** `EK4402` asks one question of a statically named value, an identifier, `.name`, `?.name`, a literal key or a destructured property: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state? That is a banned global, or a member of an allowlisted global that reaches the host: `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL`. An alias keeps the symbol, and a key that is not statically known stays unchecked. A name that resolves to nothing is `TS2304`. `docs/design/inventory/platform-globals.json` records the banned globals, the allowlist and every allowlisted member, classified, and a test fails when one is unclassified. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later"; `URL.createObjectURL` and `URL.revokeObjectURL` follow from this VIP's "All web apis and all node.js apis should be wrapped and effectful", and no `.vibe` file in the repository uses them.

## Will's words (2026-10-26)

> "All web apis and all node.js apis should be wrapped and effectful. In fact, a lot of this is ALREADY wrapped and effectful. Platform should always be dependency injected. Effect has a platform package. If it doesn't support something we should extend it to support it."

> "Make sure you do NOT implement anything that is already in effect."

> "make Effect namespace global and every namespace below Effect global and if we were forced to add something because Effect doesn't already have a namespace for it it should be under Experimental."

> "Node.js should only even be available via dependency injection or via escaping to normal typescript"
