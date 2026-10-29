# VibeLang examples

Each project has exact Effect 4.1.0 dependencies, `.vibe` sources in `src`,
and a short README. The Node examples emit ESM to `dist`; the frontend
examples build browser bundles with Vite.

| Example | Shows |
| --- | --- |
| [hello](hello/) | One function and one log; an exported `main` runs when node starts the module. |
| [users](users/) | Abstract services, layers, `wire`, typed failures, and test layers. |
| [http-api](http-api/) | A schema-validated HTTP route, conflict errors, and socket-free route tests. |
| [file-tree](file-tree/) | A recursive function with a written contract, platform services, a producer, and concurrent reads. |
| [resilience](resilience/) | Retry schedules, deadlines, races, block-owned fibers, and virtual-time tests. |
| [approval](approval/) | One release program under automatic and scripted control handlers. |
| [pipeline](pipeline/) | A producer flowing through Stream operators and a `for...of` consumer. |
| [react-vite](react-vite/) | A React component that runs a VibeLang service lookup through a `ManagedRuntime` and renders its recovered error. |
| [vue-vite](vue-vite/) | A Vue single-file component over a VibeLang layer whose setup holds the todo list. |
| [svelte-vite](svelte-vite/) | A Svelte 5 `{#await}` block over quotes that `await.all` runs concurrently. |
| [foldkit-app](foldkit-app/) | A Foldkit counter and todo list with one HTTP command, beside its Effect TypeScript original. |
| [alchemy-stack](alchemy-stack/) | An Alchemy stack with a Cloudflare Worker over an R2 bucket, beside its Effect TypeScript original; tested without credentials. |

Each example pins the published VibeLang packages; no compiler source build or Go installation is needed.
In a Node example directory, run `bun install`,
`bun run build`, and `bun run start`. In a frontend example, run
`bun install`, `bun run dev`, or `bun run test` to check and build it.
In foldkit-app or alchemy-stack, `bun run test` checks both versions with one suite.
[FRAMEWORKS.md](FRAMEWORKS.md) pairs each with its Effect TypeScript and records the forms, commands and sharp edges. The users, http-api, and resilience
projects also have `bun run test`; Vitest compiles their `.vibe` sources
through `vibelang-vite`, with source maps for assertion stacks.
Run file-tree from its own directory to find the bundled fixtures.

From the repository root, `scripts/check-examples.sh` stages disposable copies with this checkout's compiler, packed runtime and Vite plugin, installs dependencies, and checks every project. It compares the six finite programs with their output fixtures. It runs the available source tests and frontend production builds, and compiles
http-api without starting its persistent server. Build the local compiler and runtime with
`sh scripts/setup.sh` before running this repository check. Set `VIBELANG=/path/to/vibelang` to
select a compiler; otherwise it uses `vibelang` on PATH, then `typescript/built/local/tsc`.
Each project gets one status line. A failure returns exit code 1 and leaves
diagnostics in `.cache/check-examples/`. Execution has a 15-second bound.
