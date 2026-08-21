---
name: vibelang
description: Write, edit, explain, or review VibeLang (.vibe), a TypeScript superset. Use when work involves VibeLang syntax or semantics; not for ordinary TypeScript with no VibeLang behavior.
---

# Use VibeLang

Assume TypeScript knowledge. Start with ordinary TypeScript and apply only the deltas below. On the TypeScript target, `.vibe` is a true TypeScript superset. Functions stay eager and ordinary: never introduce `Effect`, `Result`, an interpreter, or `.run()`. The compiler tracks success `A`, typed failures `E`, and requirements `R` on normal function types.

## Essential deltas

- Declare a nominal failure with a TypeScript `class Name extends Error`. When a function has a body, omit its return annotation to infer both its success type and typed failure set directly from the body; inference needs no marker. Public, abstract, and declaration-only contracts use explicit `T throws E` when failures are part of the contract; async contracts use `Promise<T> throws E`. `try expr` / `try await expr` propagates; `expr catch (error) { ... }` recovers. Catch expressions handle typed failures only; defects keep unwinding.
- Define a capability as an `abstract class Name extends Context` after importing `Context` from `vibelang/context`. Access it with the inherited static `Name.context()` method. This is an ordinary-looking library call that the compiler recognizes: it returns an instance of `Name` and adds the `Name` class to the current function's inferred requirements channel. Requirements propagate through calls and callers never pass context manually. Supply implementations with `Layer` from `vibelang/provider`, normally `Layer.succeed`, `Layer.merge`, and `Layer.provide`.
- `?T` is absence, independent of failure. Use `value orelse fallback`, `if (value) |payload| ... else ...`, or `value.?` (defects if absent). Precise interop with `null`/`undefined` is not settled.
- `if`, `switch`, blocks, and loops may return values. Switches use ordinary TypeScript `case` clauses; an expression switch takes the selected case's final expression as its value. Labeled `break :label value`, loop `else`, throw expressions, `defer`, and `errdefer` follow the current expression-oriented design.
- Join concurrent operations directly with `try await.all(taskA(), taskB())`; the join is structured and unions the operations' typed failure sets. Do not introduce a separate bounded task-scope abstraction. TC39 governors are separate Stage 1 concurrency-limiting work, not structured task ownership.
- Do not use ambient host facilities such as `process`, filesystem, network, clock, or random in authored VibeLang; model them as capabilities. Runtime use of TS/JS code adds the built-in `TypeScript` requirement and unknown foreign throws add `unknown`; type-only imports do neither.

```ts
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"

class NotFound extends Error {
  constructor(readonly id: string) { super(`User not found: ${id}`) }
}
class DbFailure extends Error {
  constructor(readonly message: string) { super(message) }
}

abstract class Users extends Context {
  abstract find(id: string): Promise<?User> throws DbFailure
}

async function getUser(id: string) {
  const users = Users.context()
  const user = try await users.find(id)
  return user orelse throw new NotFound(id)
}

const App = Layer.succeed(Users, new SqlUsers())
await Layer.provide(App, async () => {
  const user = await getUser("42") catch (error) {
    switch (error.constructor) {
      case NotFound:
        User.guest()
      case DbFailure:
        throw error
    }
  }
})
```

## Spec discipline

VibeLang is in early design. In this repository, treat `docs/DECISIONS.md` as authoritative; syntax labeled proposed/open is not stable. Prefer current docs over the regex prototype: use unannotated function bodies for success and failure inference, never emit a `uses` clause or special `provide { ... }` syntax, and use the compiler-recognized `vibelang/context` API with the `vibelang/provider` library. Do not claim compiler support without verifying it.

Load detail only when needed:

- Comptime, derived schemas, typed assets, or loaders: read [references/comptime.md](references/comptime.md).
- Native/Wasm targets or Zig/Rust imports: read [references/targets.md](references/targets.md).
- Durable/distributed Actions or Flows: read [references/durable.md](references/durable.md).
