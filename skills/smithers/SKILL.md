---
name: smithers
description: Write, edit, explain, or review Smithers (.sm), a TypeScript-derived language. Use when work involves Smithers syntax or semantics; not for ordinary TypeScript with no Smithers behavior.
---

# Use Smithers

Assume TypeScript knowledge. Start with ordinary TypeScript syntax and apply only the semantic additions below. `.sm` opts into Smithers checking and lowering; imported `.ts` and `.js` preserve their host behavior.

## Essential deltas

- A synchronous fallible function returns `Result<A, E>` and an async one returns `Promise<Result<A, E>>`. Declare errors with ordinary `class Name extends Error`. Inside a Result-returning body, plain success returns and Error throws are compiler-lifted; returning an existing Result does not nest it. Use postfix `!` to propagate (`findUser(id)!`) and `match`, `recover`, or `error.match` to handle. `!` is NOT the TypeScript non-null assertion, which does not exist in `.sm`; it is the Result propagation operator, equivalent to Zig's `try foo()`. Do not emit failure annotations, prefix propagation syntax, postfix catch expressions, tagged-error factories, or `Result.ok`/`Result.err`.
- Errors have `is`, `matches`, `match`, `matchPartial`, and `rootCause` helpers. The Result API follows `better-result`: `isOk`, `isError`, `match`, `map`, `mapError`, `andThen`, `andThenAsync`, `flatten`, `recover`, `tryRecover`, the `tap`/`tapError`/`tapBoth` family with async variants, `unwrapOr`, `expect`, plus statics `Result.all`, `Result.allAsync`, `Result.partition`, `Result.partitionAsync`, `Result.try`, `Result.tryPromise`, and `Result.codec`. Results are must-use.
- There is no `Optional<T>`. Model absence as `T | undefined` and use ordinary narrowing, `?.`, and `??`. `?.` and `??` keep their normal nullish meaning and never touch failures: `!` is the error axis, `?.`/`??` are the absence axis. `arr[2]` is `T | undefined` because `noUncheckedIndexedAccess` is mandatory.
- Define a capability as `abstract class Name extends Context` after importing `Context` from `smthrs/context`. `Name.context()` returns the instance and adds `Name` to the current function's inferred requirement channel. Supply implementations with `Layer` from `smthrs/provider`.
- Promise instance `.then()`, `.catch()`, and `.finally()` are forbidden in authored Smithers. Use `await`; it unwraps only the Promise and leaves a Result visible. Static/library concurrency combinators are allowed.
- Control flow is TypeScript's, unchanged. There are NO expression-form constructs: no value-position `if` or `switch`, no block expressions, no labeled value breaks, no loop `else`, no `defer` or `errdefer`, no throw expression. The single grammar addition is `if (const x = f(); cond)`, from the TC39 Declarations in Conditionals proposal. Use `using` for scope-exit cleanup, and write error-path cleanup in the failure path.
- Do not use ambient host facilities such as `process`, filesystem, network, clock, or random in authored Smithers; model them as capabilities. Every unannotated foreign call adds the distinguished checked `panic` case. (There is no `TypeScript` requirement; TypeScript is the only compilation target.) Propagate that panic, catch it explicitly, or translate it through a trusted adapter; trusted `@throws {never}` opts out and `@throws {T}` declares a precise channel. (The POC runtime wraps unknown non-Error foreign causes in `UnhandledException` inside that panic channel.)
- Use import attributes for every non-code or foreign-source import: `with { type: "json" }`, `with { type: "json", mode: "const" }`, `with { type: "text" }`, `with { type: "zig" }`, and so on. Attribute values are strings.

```ts
import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

class NotFound extends Error {
  constructor(readonly id: string) {
    super(`User not found: ${id}`)
  }
}

class DbFailure extends Error {}

abstract class Users extends Context {
  abstract find(
    id: string,
  ): Promise<Result<User | undefined, DbFailure>>
}

async function getUser(
  id: string,
): Promise<Result<User, DbFailure | NotFound>> {
  const users = Users.context()
  const user = (await users.find(id))!
  if (user === undefined) throw new NotFound(id)
  return user
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

Import `comptime` from `smithers:comptime` and `durable` from `smithers:flows`. Both are ordinary-looking calls recognized by resolved binding identity; neither is a keyword. `comptime(value)` evaluates a value at build time, `comptime(functionValue)` marks a comptime function, and `durable(functionValue)` causes the checked body to be lowered to Plan IR without executing it.

## Spec discipline

Treat `docs/DECISIONS.md` and the specification pages as authoritative. Do not copy syntax from `prototype/` or `poc/src/language`; those directories are historical experiments and are not the current contract. Do not claim compiler support without verifying it.

Load detail only when needed:

- Comptime, derived schemas, typed assets, or loaders: read [references/comptime.md](references/comptime.md).
- Zig/Rust imports and host selection: read [references/targets.md](references/targets.md).
- Durable/distributed Actions or Flows: read [references/durable.md](references/durable.md).
