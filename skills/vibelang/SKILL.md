---
name: vibelang
description: Write, edit, explain, or review VibeLang (.vibe), a TypeScript-derived language. Use when work involves VibeLang syntax or semantics; not for ordinary TypeScript with no VibeLang behavior.
---

# Use VibeLang

Assume TypeScript knowledge. Start with ordinary TypeScript syntax and apply only the semantic additions below. `.vibe` opts into VibeLang checking and lowering; imported `.ts` and `.js` preserve their host behavior.

## Essential deltas

- A synchronous fallible function returns `Result<A, E>` and an async one returns `Promise<Result<A, E>>`. Declare errors with ordinary `class Name extends Error`. Inside a Result-returning body, plain success returns and Error throws are compiler-lifted; returning an existing Result does not nest it. Use `.unwrap()` to propagate and `match`, `recover`, or `error.match` to handle. Do not emit failure annotations, prefix propagation syntax, postfix catch expressions, tagged-error factories, or `Result.ok`/`Result.err`.
- Errors have `is`, `matches`, `match`, `matchPartial`, and `rootCause` helpers. Results have `isOk`, `isError`, `match`, `map`, `mapError`, `andThen`, `recover`, `tap`, `tapError`, `unwrap`, and `unwrapOr`. Results are must-use.
- `Optional<T>` represents absence independently from failure. In an Optional-returning function, plain values become present and nullish returns become absent. Use `match`, `map`, `andThen`, `filter`, `unwrap`, `unwrapOr`, or `toResult`. Do not emit optional-specific syntax or `Optional.some`/`Optional.none`.
- Define a capability as `abstract class Name extends Context` after importing `Context` from `vibelang/context`. `Name.context()` returns the instance and adds `Name` to the current function's inferred requirement channel. Supply implementations with `Layer` from `vibelang/provider`.
- Promise instance `.then()`, `.catch()`, and `.finally()` are forbidden in authored VibeLang. Use `await`; it unwraps only the Promise and leaves a Result visible. Static/library concurrency combinators are allowed.
- `if`, `switch`, blocks, and loops may produce values. Switches use TypeScript `case` clauses. Labeled value breaks, loop `else`, `defer`, and `errdefer` follow the expression-oriented design. Do not use throw expressions; use statement-form `throw` in a block.
- Do not use ambient host facilities such as `process`, filesystem, network, clock, or random in authored VibeLang; model them as capabilities. Runtime use of imported TS/JS adds the built-in `TypeScript` requirement, and every unannotated foreign call also adds the distinguished checked `panic` case. Propagate that panic, catch it explicitly, or translate it through a trusted adapter; trusted `@throws {never}` opts out and `@throws {T}` declares a precise channel. (The POC runtime wraps unknown non-Error foreign causes in `UnhandledException` inside that panic channel.)
- Use import attributes for every non-code or foreign-source import: `with { type: "json" }`, `with { type: "json", mode: "const" }`, `with { type: "text" }`, `with { type: "zig" }`, and so on. Attribute values are strings.

```ts
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"

class NotFound extends Error {
  constructor(readonly id: string) {
    super(`User not found: ${id}`)
  }
}

class DbFailure extends Error {}

abstract class Users extends Context {
  abstract find(
    id: string,
  ): Promise<Result<Optional<User>, DbFailure>>
}

async function getUser(
  id: string,
): Promise<Result<User, DbFailure | NotFound>> {
  const users = Users.context()
  const user = (await users.find(id)).unwrap()
  return user.toResult(() => new NotFound(id))
}

const App = Layer.succeed(Users, new SqlUsers())
await Layer.provide(App, async () => {
  const user = (await getUser("42")).match({
    ok: user => user,
    error: error => error.match({
      NotFound: () => User.guest(),
      DbFailure: error => { throw error },
    }),
  })
})
```

## Compiler intrinsics

Import `comptime` from `vibelang:comptime` and `durable` from `vibelang:flows`. Both are ordinary-looking calls recognized by resolved binding identity; neither is a keyword. `comptime(value)` evaluates a value at build time, `comptime(functionValue)` marks a comptime function, and `durable(functionValue)` causes the checked body to be lowered to Plan IR without executing it.

## Spec discipline

Treat `docs/DECISIONS.md` and the specification pages as authoritative. Do not copy syntax from `prototype/` or `poc/src/language`; those directories are historical experiments and are not the current contract. Do not claim compiler support without verifying it.

Load detail only when needed:

- Comptime, derived schemas, typed assets, or loaders: read [references/comptime.md](references/comptime.md).
- Native/Wasm targets or Zig/Rust imports: read [references/targets.md](references/targets.md).
- Durable/distributed Actions or Flows: read [references/durable.md](references/durable.md).
