# Start a new project

Create a project from the VibeLang starter. It builds with the `vibelang` CLI and tests with Vitest through `vibelang-vite`, so it needs no build page. Compare each command's output with the expected output.

## 1. Create the project

![bun create vibelang@latest](/videos/term-create.mp4)

Choose a new directory name or an empty directory. With npm, run:

```sh
npm create vibelang@latest my-app
```

With Bun as the package manager (optional; the app runs on Node), run:

```sh
bun create vibelang@latest my-app
```

With pnpm, run `pnpm create vibelang@latest my-app`. For pnpm the starter also writes `pnpm-workspace.yaml` with the Effect pin and `allowBuilds: { dprint: true }`, the settings in [Add VibeLang to an existing project](existing-project.md): pnpm 11 and later stop an install with `ERR_PNPM_IGNORED_BUILDS` while `dprint`'s install script is neither allowed nor denied.

The starter's `start` script runs Node and uses `@effect/platform-node`, even when Bun installs its dependencies. To use Bun as the runtime, see [Run sources with Bun](vibelang-cli.md#run-sources-with-bun).

The starter prints:

```out
Created my-app with VibeLang 0.0.13.
Installing dependencies with npm...
```

With Bun or pnpm, the second line names that manager. The command copies the starter into `my-app`, pins `vibelang`, `vibelang-runtime`, and `vibelang-vite` to its own version, and installs dependencies with the package manager that ran it. It refuses a non-empty directory and never runs `git init`. `--no-install` skips installation; npm needs `--` before starter options:

```sh
bun create vibelang my-app --no-install
npm create vibelang@latest my-app -- --no-install
```

If the destination cannot be created or written, the starter reports the target and filesystem error code. Check that each parent path is a directory and that you have permission to write there, then retry with a new or empty directory.

The starter includes npm/Bun `overrides`, Yarn `resolutions` and, with pnpm, `pnpm-workspace.yaml` `overrides` that keep
`@effect/platform-node-shared` at the runtime's exact Effect version, including
when you switch package managers.

Then run `bun install`, `npm install` or `pnpm install` in `my-app` before step 2.

## 2. Build and run

```sh
cd my-app
bun run start
```

With npm, run `npm run start`. The output ends:

```out
Hello, VibeLang!
Recovered from EmptyName
```

## 3. Run the tests

![bun run test](/videos/term-test.mp4)

```sh
bun run test
```

The starter tests check a successful greeting and recovery from an empty name. With npm, run `npm run test`. The output includes:

```out
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

`bun run dev` waits until the compiler is watching before starting the program, then rebuilds and restarts it on every save until Ctrl+C stops it. Don't run it in a session that waits for each command to exit.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).
