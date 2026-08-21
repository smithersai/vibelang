---
name: vibelang
description: Write, edit, explain, or review VibeLang (.vibe), a TypeScript superset. Use when work involves VibeLang syntax or semantics; not for ordinary TypeScript with no VibeLang behavior.
---

# Use VibeLang

Assume TypeScript knowledge. Start with ordinary TypeScript and apply only the deltas below. On the TypeScript target, `.vibe` is a true TypeScript superset. Functions stay eager and ordinary: never introduce `Effect`, `Result`, an interpreter, or `.run()`. The compiler tracks success `A`, typed failures `E`, and requirements `R` on normal function types.

## Essential deltas

- Declare a nominal failure with `error Name { fields }`. Use `!T` to infer an internal function's failure set and `T throws E` to pin a public contract. `try expr` / `try await expr` propagates; `expr catch fallback` recovers. Catch expressions handle typed failures only; defects keep unwinding. Async failures use `Promise<T, E>`.
- Declare lexical capabilities with `uses name: Type`; requirements propagate through calls. Capabilities are nominal classes. Supply them with `Layer` from `vibelang:provider`, normally `Layer.succeed`, `Layer.merge`, and `Layer.provide`.
- `?T` is absence, independent of failure. Use `value orelse fallback`, `if (value) |payload| ... else ...`, or `value.?` (defects if absent). Precise interop with `null`/`undefined` is not settled.
- `if`, `switch`, blocks, and loops may return values. Labeled `break :label value`, loop `else`, throw expressions, `defer`, and `errdefer` follow the current Zig-inspired design.
- Do not use ambient host facilities such as `process`, filesystem, network, clock, or random in authored VibeLang; model them as capabilities. Runtime use of TS/JS code adds the built-in `TypeScript` requirement and unknown foreign throws add `unknown`; type-only imports do neither.

```ts
import { Layer } from "vibelang:provider"

error NotFound { id: string }
error DbFailure { message: string }

abstract class Users {
  abstract find(id: string): Promise<?User, DbFailure>
}

async function getUser(id: string): !User uses users: Users {
  const user = try await users.find(id)
  return user orelse throw NotFound({ id })
}

const App = Layer.succeed(Users, new SqlUsers())
await Layer.provide(App, async () => {
  const user = await getUser("42") catch |e| switch (e) {
    NotFound => User.guest(),
    DbFailure => throw e,
  }
})
```

## Spec discipline

VibeLang is in early design. In this repository, treat `docs/DECISIONS.md` as authoritative; syntax labeled proposed/open is not stable. Prefer current docs over the regex prototype: never emit its obsolete `uses A, B` or special `provide { ... }` syntax. Do not claim compiler support without verifying it.

Load detail only when needed:

- Comptime, derived schemas, typed assets, or loaders: read [references/comptime.md](references/comptime.md).
- Native/Wasm targets or Zig/Rust imports: read [references/targets.md](references/targets.md).
- Durable/distributed Actions or Flows: read [references/durable.md](references/durable.md).
