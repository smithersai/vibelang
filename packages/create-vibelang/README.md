# create-vibelang

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

Create a [VibeLang](https://vibelang.sh) application. VibeLang is a readable
syntax for Effect that compiles to JavaScript with TypeScript declarations.

```sh
npm create vibelang@latest my-app
# or with Bun
bun create vibelang@latest my-app
# or scaffold an Effect UI browser app (Vite + @effect/ui + Story/Scene tests)
npm create vibelang@latest my-app -- --ui
```

The command copies a starter app into `my-app`, pins `vibelang`,
`vibelang-runtime`, and `vibelang-vite` to its own version, and installs
dependencies with the package manager that ran it. It refuses a non-empty
directory and never runs `git init`. If a filesystem error prevents creation, it
reports the target and error code. Check the path and directory permissions,
then retry with a new or empty directory.

| Option | Effect |
| --- | --- |
| `-h`, `--help` | Print usage and exit without creating a project. |
| `-v`, `--version` | Print the scaffolder version and exit. |
| `--ui` | Scaffold a Vibe + `@effect/ui` browser starter with Vite, `@effect/ui-kit`, `@effect/ui-devtools`, `exactOptionalPropertyTypes: true`, and `Story`/`HtmlScene` tests. |
| `--smithers` | Add `WORKSPACE.ts` and `PACKAGE.ts` build targets using `@smthrs/targets` and `@smthrs/cli` (`smthrs ci //...`). |
| `--no-install` | Copy the app without installing dependencies. |
| `--no-git` | Accepted for compatibility with `bun create`; nothing changes. |

Then run the default Node starter:

```sh
cd my-app
npm run start    # build and run src/main.vibe
npm run dev      # rebuild and restart on every save
npm run test     # run the .vibe tests with Vitest
```

Or run the `--ui` Effect UI starter:

```sh
cd my-app
npm run dev      # start the Vite dev server with Effect UI DevTools
npm run test     # run Story and HtmlScene tests with Vitest
npm run build    # type-check with vibe --noEmit and build for production
```

## Editor support

The `vibelang` package ships the VS Code extension. After the install, run one of:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

The extension starts the project's own compiler as the language server.

## Requirements

Node 22.22.3 (22.x) or Node 24.11.1 or later. The starter app depends on `effect@4.1.6`
(VibeLang's runtime supports `effect@^4.1.0`).
