# Start a new project

Create a project from the VibeLang starter. It builds with the `vibelang` CLI and tests with Vitest through `vibelang-vite`. Compare each command's output with the expected output below.

## 1. Create the project

![bun create vibelang@latest](/videos/term-create.mp4)

Choose a new or empty directory. With npm:

```sh
npm create vibelang@latest my-app
```

With Bun as the package manager (optional; the app runs on Node):

```sh
bun create vibelang@latest my-app
```

With pnpm, run `pnpm create vibelang@latest my-app`. The starter also writes `pnpm-workspace.yaml` with the Effect pin and `allowBuilds: { dprint: true }` ([existing project](existing-project.md#2-install-the-packages)), which pnpm 11+ requires for `dprint`'s install script.

The starter's `start` script runs Node with `@effect/platform-node` even when Bun installs dependencies. To run directly on Bun, see [Run sources with Bun](vibelang-cli.md#run-sources-with-bun).

Expected output (naming your chosen package manager on line 2):

```out
Created my-app with VibeLang 0.0.13.
Installing dependencies with npm...
```

The command copies the starter, pins `vibelang`, `vibelang-runtime`, and `vibelang-vite` to its own version, writes npm/Bun `overrides` and Yarn `resolutions` for `@effect/platform-node-shared`, and installs dependencies. It refuses non-empty directories and never runs `git init`. Pass `--no-install` to skip installation, then run your package manager's install command before step 2:

```sh
bun create vibelang my-app --no-install
npm create vibelang@latest my-app -- --no-install
```

## 2. Build and run

```sh
cd my-app
bun run start
```

With npm, run `npm run start`. Expected output:

```out
Hello, VibeLang!
Recovered from EmptyName
```

## 3. Run the tests

![bun run test](/videos/term-test.mp4)

```sh
bun run test
```

With npm, run `npm run test`. Expected summary:

```out
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

`bun run dev` watches for changes, rebuilding and restarting on every save until Ctrl+C. Don't run it in a session that waits for commands to exit.

## Next

Set up your editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).
