# Getting Started

Create a project, run it, test it, and find the guide you need. [Welcome](001-onboarding.md) explains what VibeLang is. This page gets a program running.

## Create and run a project

You need Node 22.22.3 or later. Bun is optional, at 1.4 or later.

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
npm run test
```

With Bun as the package manager:

```sh
bun create vibelang@latest my-app
cd my-app
bun run start
bun run test
```

The starter prints:

```out
Hello, VibeLang!
Recovered from EmptyName
```

`src/greeting.vibe` declares an `EmptyName` error and a `greeting` function that fails with it. `src/main.vibe` declares a `Greeter` service, supplies it with a `Layer.succeed` layer, recovers from the typed failure, and runs `main` with `NodeRuntime.runMain` at the top of the module. `src/greeting.test.vibe` tests both paths with `it.effect`. Vitest compiles `src/**/*.test.vibe` through `vibelang-vite`, so the tests need no build step.

`npm run dev` (or `bun run dev`) recompiles on every change and restarts Node when the output changes. Ctrl+C stops both watchers.

## Your first program

The starter's behavior fits in one file. An `effect` function returns an Effect, `throw` fails it with a typed error, `try` runs an Effect, and `catch` handles the failure:

```vibe
// run: try main()
error EmptyName

effect function greeting(name: string) {
  if (name.length === 0) throw new EmptyName()
  return `Hello, ${name}!`
}

effect function main() {
  try Console.log(try greeting("VibeLang"))
  const recovered = greeting("") catch (error) => `Recovered from ${error._tag}`
  try Console.log(recovered)
}
// Output: Hello, VibeLang!
// Output: Recovered from EmptyName
```

The compiler infers the type of `greeting` as `string!EmptyName`, which is `Effect<string, EmptyName, never>`. A caller that forgets the failure gets a compile error, not a crash at runtime. [The Effect Type](getting-started/003-the-effect-type.md) explains the contract, [Creating Effects](getting-started/005-creating-effects.md) adds failures, and [Running Effects](getting-started/009-running-effects.md) runs a program at the application boundary.

## Set up your editor

The editor extension ships inside the compiler package. For diagnostics and hovers in VS Code or Cursor, install it and open the project:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
```

[Installation](getting-started/004-installation.md) covers prerequisites, supported platforms, Neovim and Zed, and adding VibeLang to an existing project.

## Debug your first program

Run the emitted JavaScript with `node --enable-source-maps`, and stack traces map back to `.vibe` lines. Source maps do not record the caller chain, and VibeLang adds no spans of its own. Name a span where it matters with `try withSpan(effect { ... }, "load")`. [Debug stack traces](getting-started/012-devtools.md#debug-stack-traces) covers source maps, named spans and a debugging entry.

## Documentation versions

These pages target Effect **4.1.1**, the version the compiled output requires. On the Effect site, select version 4. Effect 3 examples use a different library version and do not establish which APIs exist here. When a signature on these pages differs from the one in your installed package, trust the package.

## Find a subject

The directories group guides by task:

- [Error management](error-management/006-two-error-types.md): failures, recovery, retry and timeouts.
- [Concurrency](concurrency/007-basic-concurrency.md): bounded parallel work and fiber lifetimes.
- [Requirements](requirements-management/025-services.md): services and layers.
- [Resources](resource-management/029-introduction.md): acquisition and cleanup.
- [Schema](schema/085-introduction.md): decoding and validating external data.
- [Observability](observability/031-logging.md): logs, metrics, spans and fibers.
- [Streams](stream/053-introduction.md): incremental processing with backpressure.

The numbered file names keep the learning sequence. You need not read every page in order. The [cheat sheet](vibelang-features/115-cheat-sheet.md) puts every VibeLang form beside the Effect code it replaces, and the [Effect 4 API reference](https://effect.website/docs/v4/api) lists the library signatures. In VibeLang, pass Effect values directly and run them with `try`.

## Coding agents

The `vibelang` package ships the skill an agent loads before it writes `.vibe` files, at `node_modules/vibelang/skills/vibelang/SKILL.md`. `npx vibelang agents init` installs it for the agents in a repository, with the language server and a check after each edit. [Coding agents](setup/coding-agents.md) has the steps. Give the model the guide for the task and your own `error` and `service` declarations, then check the result with the compiler and focused tests.

[Upstream Effect page](https://effect.website/docs/v4/getting-started)
