# create-vibelang

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

Create a [VibeLang](https://vibelang.sh) application. VibeLang is a readable
syntax for Effect that compiles to JavaScript with TypeScript declarations.

```sh
bun create vibelang@latest my-app
# or
npm create vibelang@latest my-app
```

The command copies a starter app into `my-app`, pins `vibelang`,
`vibelang-runtime`, and `vibelang-vite` to its own version, and installs
dependencies with the package manager that ran it. It refuses a non-empty
directory and never runs `git init`.

| Option | Effect |
| --- | --- |
| `-h`, `--help` | Print usage and exit without creating a project. |
| `-v`, `--version` | Print the scaffolder version and exit. |
| `--no-install` | Copy the app without installing dependencies. |
| `--no-git` | Accepted for compatibility with `bun create`; nothing changes. |

Then run the app:

```sh
cd my-app
bun run start    # build and run src/main.vibe
bun run dev      # rebuild and restart on every save
bun run test     # run the .vibe tests with Vitest
```

With npm, use `npm run start`, `npm run dev`, and `npm run test`.

## Editor support

The `vibelang` package ships the VS Code extension. After the install, run one of:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

The extension starts the project's own compiler as the language server.

## Requirements

Node 22.22.3 (22.x) or Node 24.11.1 or later. The starter app depends on `effect@4.0.6` exactly, the
version the VibeLang runtime is built against.
