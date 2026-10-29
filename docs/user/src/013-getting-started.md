# Getting Started

These guides teach VibeLang one topic at a time and serve as a reference while you build. Start with [Welcome](001-onboarding.md) or jump to the subject you need.

## Create and run your first project

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
npm run test
```

With Bun (optional):

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

`src/greeting.vibe` defines a greeting function and an `EmptyName` tagged error. `src/main.vibe` declares the `Greeter` service, supplies its `Layer.succeed` layer, recovers a typed failure with a `catch` expression, and calls `NodeRuntime.runMain(main())` at module top level when `node dist/main.js` loads it. `src/greeting.test.vibe` tests success and recovery with `it.effect`. Vitest compiles `src/**/*.test.vibe` through `vibelang-vite`, so tests need no prior build.

`npm run dev` (or `bun run dev`) compiles on changes and restarts Node when output changes; Ctrl+C stops both watchers. For diagnostics and hovers in VS Code or Cursor, install the extension that ships in `vibelang`, then open the project:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
```

[Installation](getting-started/004-installation.md) covers prerequisites, supported platforms, editor setup, and existing projects.

## Debug your first program

For source-located caller traces during development, set `vibe.tracing`
to `"all"` at the top level of `tsconfig.json`:

```json
{ "vibe": { "tracing": "all" } }
```

Merge this into your existing config, then rebuild or restart `npm run dev`
(or `bun run dev`). It records local and exported function calls; source
maps alone do not record that caller chain. Tracing adds runtime work and
defaults to `"none"`. See [Debug stack traces](getting-started/012-devtools.md#debug-stack-traces)
for source maps, named spans and a debugging entry.

## Guides and reference material

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try Effect.provide(main(), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))])))
effect main() {
  const label = "first program"
  try log(label)
  return label.length
}
// number!!
// Output: first program
// Output: 13
```

Read [The Effect Type](getting-started/003-the-effect-type.md) for this function's contract, [Creating Effects](getting-started/005-creating-effects.md) to add failures, and [Running Effects](getting-started/009-running-effects.md) to run it at an application boundary. Each guide explains a use case. The [Effect 4 API reference](https://effect.website/docs/v4/api) lists library signatures; in VibeLang, pass Effect values directly and run them with `try`.

## Documentation versions

These pages target Effect **4.0.6** and the language decisions recorded with this repository. Upstream, select version 4. Effect 3 examples use a different library version and do not establish which APIs exist here.

The upstream site also documents newer changes. When a signature differs from an example on these pages, check it against your installed package.

## Finding a subject

The directories group guides by task:

- [Error management](error-management/006-two-error-types.md): failures, recovery, retry, and timeouts.
- [Concurrency](concurrency/007-basic-concurrency.md): bounded parallel work and fiber lifetimes.
- [Requirements](requirements-management/025-services.md): services and layers.
- [Resources](resource-management/029-introduction.md): acquisition and cleanup.
- [Schema](schema/085-introduction.md): decoding and validating external data.
- [Observability](observability/031-logging.md): logs, metrics, spans, and fibers.
- [Streams](stream/053-introduction.md): incremental processing with backpressure.

Find a specific operation by each page's headings; in a Markdown reader, follow the outline or search for an API name. The numbered file names keep the learning sequence, but you needn't read every page in order.

## Using documentation with language models

Give the model the relevant VibeLang guide with the Effect API signature. State that an `effect` function returns an unrun Effect, that `try` runs it, and that an operator takes the Effect value directly, as in `try retry(fetchReport(), policy)`, while `fork fetchReport()` starts it in a child fiber. Include your error and service declarations so generated code can preserve the contract.

Check the result with compiler feedback and focused tests. Effect's TypeScript tooling applies to `.ts` integration code; the [Devtools](getting-started/012-devtools.md) page covers VibeLang's compiler, language server, linting, and debugging setup.

[Upstream Effect page](https://effect.website/docs/v4/getting-started)
