# Vibe

[![npm](https://img.shields.io/npm/v/vibelang)](https://www.npmjs.com/package/vibelang)
[![license](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-blue)](#license)

Write [Effect](https://effect.website) programs in TypeScript syntax, with typed errors and services the compiler checks.

Published on npm as [`vibelang`](https://www.npmjs.com/package/vibelang) (providing both the `vibe` and `vibelang` commands, like Go/Golang).

[Playground](https://vibelang.sh/play) · [Effect UI](https://vibelang.sh/setup/effect-ui) · [Get started](https://vibelang.sh) · [Cheat sheet](https://vibelang.sh/vibelang-features/115-cheat-sheet) · [Contribute](CONTRIBUTING.md)

> [!IMPORTANT]
> Vibe 0.0.14 is in early alpha. The [specification](https://vibelang.sh/spec) describes the accepted VIPs in the supported core. Some accepted features beyond that core are experimental and require an opt-in. See [what is in the alpha](https://vibelang.sh/setup/alpha).

> [!WARNING]
> Vibe is v0. The language will change in major, breaking ways. It is not suitable for production use.

> [!NOTE]
> The latest code is on the [`vibe`](https://github.com/smithersai/vibelang/tree/vibe) branch. `main` holds accepted code.

<p align="center"><img src="site/public/alpha-to-beta.svg" alt="From alpha to beta, with no dates: alpha works and is slop, behaviour settles, a person reads every line, then beta isn't slop." width="100%"></p>

<!-- compatibility:start -->
> **Compatibility.** Supports `effect@^4.1.0` (tested on `effect@4.1.6`); keep `@effect/platform-node` and `@effect/vitest` on matching `4.1.x` versions when used. No `@effect/platform-node-shared` override is required.
>
> Use `vibe` (or `vibelang`) to check `.vibe` source. Stock `tsc` and `vue-tsc` see only the `x.d.vibe.ts` declarations the compiler writes, which resolve `.vibe` imports when `allowArbitraryExtensions` is on.
>
> For mixed editing in VS Code, let the Vibe server own TypeScript files: disable the built-in TypeScript and JavaScript Language Features extension for this workspace.
>
> [Setup details](https://vibelang.sh/setup/existing-project) · [Editor setup](https://vibelang.sh/getting-started/012-devtools)
<!-- compatibility:end -->

## Why Vibe

Compiler-checked soundness, zero-ceremony Effect syntax, and AI-era reliability — built directly on TypeScript 7 and Effect 4. Vibe ships no quick fixes or codemods of its own before its first release. TypeScript's built-in code fixes remain available.

Effect gives you typed failures, dependency injection, concurrency and resource management. Vibe gives those programs direct syntax: an `effect` function returns an Effect, `try` runs one, and its errors and required services stay in its type. Every form is exact sugar for the Effect TypeScript it replaces.

Plain and `async` functions are TypeScript's, so your `.ts` code and npm packages call as they do in TypeScript. The compiler tracks what a function may throw, and Effect code calls one that may throw through Effect's own `Effect.try` ([TypeScript boundaries](https://vibelang.sh/vibelang-features/114-vibelang-for-effect-users#keep-platform-work-in-effect)):

```vibe
import { parseSettings } from "./settings.ts"
error BadSettings { cause: unknown }

effect function settings(text: string) {
  return try Effect.try({ try: () => parseSettings(text), catch: (cause) => new BadSettings({ cause }) })
}
```

Use Effect services for platform, clock and randomness APIs, such as `Console`, `Clock`, `Random` and `FileSystem`. A `.vibe` file reaches Node.js and web APIs only through Effect's services, provided by a platform layer ([platform services](https://vibelang.sh/platform/105-introduction)).

### Effect UI in Vibe

Build browser and terminal apps with [`@effect/ui`](https://vibelang.sh/setup/effect-ui) — typed `schema` models, `schema error`, `service` + `Layer.effect`, switch-mode `Command.Service`, live `effect function*` progress subscriptions, and exhaustive `match` in views:

```sh
npm create vibelang@latest my-app -- --ui
cd my-app
npm run dev
npm run test
```

Try it live in the browser [Playground](https://vibelang.sh/play) or inspect the three flagship showcase apps:

- [effect-ui-domains](examples/effect-ui-domains/) — full-stack domain search (`HttpApi`, `Query.Service`, `@effect/ui-kit` Dialog/Select/Button, Effect TS parity tests)
- [effect-ui-uploads](examples/effect-ui-uploads/) — concurrent uploads (`Command.Service` fiber cancellation, VIP-21 `effect function*` progress stream, `@effect/ui-devtools`)
- [effect-ui-snake](examples/effect-ui-snake/) — one `.vibe` Snake core mounted to both `@effect/ui/html` (Web) and `@effect/ui-opentui` (Terminal)

### One program in both languages

Here is one program in both languages: a typed failure, an injected service, two concurrent lookups and a fallback.

**Vibe**

```vibe
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

**6.7% fewer tokens across 47 cheat-sheet pairs; VibeLang is longer in 20 pairs.** The example above uses **136 vs 202 tokens (32.7% fewer)**.

<!-- token-headline:end -->

Counts use o200k_base. Both print `Ada Guest`. The counts cover the complete source files, including TypeScript's imports and runner, which VibeLang supplies. It is one example, not a general ratio. [Reproduce the counts and both runs](.smithers/token-compare/README.md). [Token counts](docs/user/src/vibelang-features/117-token-counts.md) measures the skill agents load, the docs and every cheat-sheet pair.

`service` declares a dependency and `provide` supplies it. `try` runs an Effect, `try.all` runs Effects concurrently, and `catch` handles the declared failure. `Console` and `Layer` are in scope without imports, and the module runs `main` with a runner, as Effect TypeScript does. A contract reads `Result!Error!Services`, exactly `Effect.Effect<Result, Error, Services>`; leave it out and the compiler infers it.

`match` is TC39 pattern matching with exhaustiveness checks and generated error matchers: leave a variant of a `data` type out of a match without `default`, and the compiler reports the missing case.

The compiler checks `.vibe` and `.ts` files together and emits JavaScript. Set `"declaration": true` in `compilerOptions` to emit `.d.ts` files for TypeScript consumers. The starter leaves declaration output off. For stock TypeScript tools the compiler still writes a `.d.vibe.ts` declaration per module, which the starter keeps in its ignored `.vibe/declarations/` folder.

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

For an Effect UI browser app (Vite + `@effect/ui` + `@effect/ui-kit` + `Story`/`HtmlScene` tests):

```sh
npm create vibelang@latest my-app -- --ui
cd my-app
npm run dev
npm run test
```

The starter's `start` script runs Node and uses `@effect/platform-node`, even when Bun installs its dependencies. To use Bun as the runtime, see [Run sources with Bun](docs/user/src/setup/vibelang-cli.md#run-sources-with-bun).

You need Node 22.22.3 (22.x) or Node 24.11.1 or later. If you use Bun, use Bun 1.4.2 or later. Bun is optional. `npm run start` prints:

```text
Hello, VibeLang!
Recovered from EmptyName
```

Replace `src/main.vibe` with this program and run `npm run start` again:

```vibe
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

- [Playground](https://vibelang.sh/play): compile and run Vibe in the browser with live Effect UI previews
- [Effect UI guide](https://vibelang.sh/setup/effect-ui): side-by-side Effect TS and Vibe patterns for Web and OpenTUI apps
- [Guides and reference](https://vibelang.sh)
- [Syntax cheat sheet](https://vibelang.sh/vibelang-features/115-cheat-sheet): every form beside the Effect code it replaces
- [Vibe for Effect users](https://vibelang.sh/vibelang-features/114-vibelang-for-effect-users)
- [Specification](docs/design/src/000-intro.md)
- [Examples](examples/README.md): Effect UI (Domains, Uploads, Web + OpenTUI Snake), services, HTTP API, retries and races, streams, React, Vue and Svelte

## Help build it

Report a bug in the published packages, with a minimal reproduction, in [Issues](https://github.com/smithersai/vibelang/issues/new/choose). A maintainer accepts issues for discussion, labels each with an expected timeline and commitment, and links a proof of concept as a draft pull request titled `poc: #<n>` that you can check out and run. [CONTRIBUTING.md](CONTRIBUTING.md) explains the process and language proposals, and [MAINTAINERS.md](MAINTAINERS.md) covers triage and releases. Report vulnerabilities privately through [SECURITY.md](.github/SECURITY.md).

## License

[MIT](LICENSE), except the TypeScript fork in [`typescript/`](typescript/) and the compiler packages built from it — `vibelang`, `vibelang-<platform>`, `@smthrs/cli-win32-x64`, `@smthrs/cli-win32-arm64`, and `vibelang-typescript` — which use the [Apache License 2.0](typescript/LICENSE.txt) and keep its [notices](typescript/NOTICE.txt).

<sub>2,812 tokens (o200k_base, js-tiktoken 1.0.21), counted by the [docs flow](.smithers/flows/docs/flow.ts).</sub>
