# VibeLang

[![npm](https://img.shields.io/npm/v/vibelang)](https://www.npmjs.com/package/vibelang)
[![license](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-blue)](#license)

Write [Effect](https://effect.website) programs in TypeScript syntax, with typed errors and services the compiler checks.

[Get started](https://vibelang.sh) · [Cheat sheet](https://vibelang.sh/vibelang-features/115-cheat-sheet) · [Contribute](CONTRIBUTING.md)

> [!WARNING]
> VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

<!-- compatibility:start -->
> **Compatibility.** Use exactly `effect@4.1.0`; keep `@effect/platform-node` and `@effect/vitest` at `4.1.0` when used.
>
> Existing projects need an `@effect/platform-node-shared` override. The starter includes the pins and override.
>
> Use `vibelang` to check `.vibe` source. Stock `tsc` and `vue-tsc` see only the `x.d.vibe.ts` declarations the compiler writes, which resolve `.vibe` imports when `allowArbitraryExtensions` is on.
>
> For mixed editing in VS Code, let the VibeLang server own TypeScript files: disable the built-in TypeScript and JavaScript Language Features extension for this workspace.
>
> [Setup details](https://vibelang.sh/setup/existing-project) · [Editor setup](https://vibelang.sh/getting-started/012-devtools)
<!-- compatibility:end -->

## Why VibeLang

Effect gives you typed failures, dependency injection, concurrency and resource management. VibeLang gives those programs direct syntax: an `effect` function returns an Effect, `try` runs one, and its errors and required services stay in its type. Every form is exact sugar for the Effect TypeScript it replaces.

Plain and `async` functions are TypeScript's, so your `.ts` code and npm packages call as they do in TypeScript. The compiler tracks what a function may throw, and Effect code calls one that may throw through Effect's own `Effect.try` ([TypeScript boundaries](https://vibelang.sh/vibelang-features/114-vibelang-for-effect-users#keep-platform-work-in-effect)):

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13
import { parseSettings } from "./settings.ts"
error BadSettings { cause: unknown }

effect function settings(text: string) {
  return try Effect.try({ try: () => parseSettings(text), catch: (cause) => new BadSettings({ cause }) })
}
```

Use Effect services for platform, clock and randomness APIs, such as `Console`, `Clock`, `Random` and `FileSystem`. A `.vibe` file reaches Node.js and web APIs only through Effect's services, provided by a platform layer ([platform services](https://vibelang.sh/platform/105-introduction)).

Here is one program in both languages: a typed failure, an injected service, two concurrent lookups and a fallback.

**VibeLang**

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-9, VIP-12, VIP-13, VIP-18, VIP-26
error UserNotFound { id: string }
service Users {
  find(id: string): string!UserNotFound
}

const UsersLive = Layer.succeed(Users, {
  effect find(id: string) {
    if (id !== "42") throw new UserNotFound({ id })
    return "Ada"
  }
})

export effect function main() {
  provide UsersLive {
    const users = try Users
    const [name, fallback] = try.all [
      users.find("42"),
      effect { return users.find("7") catch () => "Guest" }
    ]
    try Console.log(name, fallback)
  }
}

runPromise(main())
```

**Effect 4 TypeScript**

```ts
import { Console, Context, Data, Effect, Layer } from "effect"

class UserNotFound extends Data.TaggedError("UserNotFound")<{ id: string }> {}
class Users extends Context.Service<Users, {
  find: (id: string) => Effect.Effect<string, UserNotFound>
}>()("Users") {}

const UsersLive = Layer.succeed(Users, {
  find: (id: string) => id === "42"
    ? Effect.succeed("Ada")
    : Effect.fail(new UserNotFound({ id }))
})

const main = Effect.gen(function* () {
  const users = yield* Users
  const [name, fallback] = yield* Effect.all([
    users.find("42"),
    users.find("7").pipe(Effect.catch(() => Effect.succeed("Guest")))
  ], { concurrency: "unbounded" })
  yield* Console.log(name, fallback)
}).pipe(Effect.provide(UsersLive))

Effect.runPromise(main)
```

<!-- token-headline:start -->

**6.6% fewer tokens across 47 cheat-sheet pairs; VibeLang is longer in 20 pairs.** The example above uses **136 vs 202 tokens (32.7% fewer)**.

<!-- token-headline:end -->

Counts use o200k_base. Both print `Ada Guest`. The counts cover the complete source files, including TypeScript's imports and runner, which VibeLang supplies. It is one example, not a general ratio. [Reproduce the counts and both runs](.smithers/token-compare/README.md). [Token counts](docs/user/src/vibelang-features/117-token-counts.md) measures the skill agents load, the docs and every cheat-sheet pair.

`service` declares a dependency and `provide` supplies it. `try` runs an Effect, `try.all` runs Effects concurrently, and `catch` handles the declared failure. `Console` and `Layer` are in scope without imports, and the module runs `main` with a runner, as Effect TypeScript does. A contract reads `Result!Error!Services`, exactly `Effect.Effect<Result, Error, Services>`; leave it out and the compiler infers it.

`match` is TC39 pattern matching with exhaustiveness checks and generated error matchers: leave a variant of a `data` type out of a match without `default`, and the compiler reports the missing case.

The compiler checks `.vibe` and `.ts` files together and emits JavaScript. Set `"declaration": true` in `compilerOptions` to emit `.d.ts` files for TypeScript consumers. The starter leaves declaration output off.

## Start here

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
npm run test
```

With Bun as the package manager (optional; the app runs on Node):

```sh
bun create vibelang@latest my-app
cd my-app
bun run start
bun run test
```

The starter's `start` script runs Node and uses `@effect/platform-node`, even when Bun installs its dependencies. To use Bun as the runtime, see [Run sources with Bun](docs/user/src/setup/vibelang-cli.md#run-sources-with-bun).

You need Node 22.22.3 (22.x) or Node 24.11.1 or later. If you use Bun, use Bun 1.4 or later. Bun is optional. `npm run start` prints:

```text
Hello, VibeLang!
Recovered from EmptyName
```

Replace `src/main.vibe` with this program and run `npm run start` again:

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-13, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

error EmptyName
effect function greet(name: string): string!EmptyName {
  if (name === "") throw new EmptyName()
  return `Hello, ${name}!`
}

export effect function main() {
  try Console.log(try greet("VibeLang"))
  const recovered = greet("") catch () => "Hello, stranger!"
  try Console.log(recovered)
}

NodeRuntime.runMain(main())
```

```text
Hello, VibeLang!
Hello, stranger!
```

To add VibeLang to an existing project, see [Installation](https://vibelang.sh/getting-started/004-installation).

## Editors

The `vibelang` package ships a VS Code and Cursor extension. From your project, after installing dependencies:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
```

Use `cursor` instead of `code` for Cursor. The extension isn't on the marketplaces yet. It runs the project's compiler as a language server for diagnostics, hovers and completions. [Editor setup](editors/README.md) covers Neovim, Zed and other LSP clients.

## Learn more

- [Guides and reference](https://vibelang.sh)
- [Syntax cheat sheet](https://vibelang.sh/vibelang-features/115-cheat-sheet): every form beside the Effect code it replaces
- [VibeLang for Effect users](https://vibelang.sh/vibelang-features/114-vibelang-for-effect-users)
- [Specification](docs/design/src/000-intro.md)
- [Examples](examples/README.md): services, an HTTP API, retries and races, streams, React, Vue and Svelte

## Help build it

Report a bug with a minimal reproduction, or propose an idea, in [Issues](https://github.com/smithersai/vibelang/issues/new/choose). A maintainer accepts issues for discussion, labels each with an expected timeline and commitment, and links a proof of concept as a draft pull request titled `poc: #<n>` that you can check out and run. [CONTRIBUTING.md](CONTRIBUTING.md) explains the process, and [MAINTAINERS.md](MAINTAINERS.md) covers triage and releases. Report vulnerabilities privately through [SECURITY.md](.github/SECURITY.md).

## License

[MIT](LICENSE), except the TypeScript fork in [`typescript/`](typescript/) and the compiler packages built from it, `vibelang` and `vibelang-<platform>`, which use the [Apache License 2.0](typescript/LICENSE.txt) and keep its [notices](typescript/NOTICE.txt).

<sub>2,296 tokens (o200k_base, js-tiktoken 1.0.21), counted by the [docs flow](.smithers/flows/docs/flow.ts).</sub>
