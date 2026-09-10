<p align="center">
  <a href="https://vibelang.sh">
    <img src="https://raw.githubusercontent.com/smithersai/vibelang/main/.github/logo.svg" alt="VibeLang" width="320">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vibelang"><img src="https://img.shields.io/npm/v/vibelang?logo=npm&label=npm&color=1F6FEB" alt="npm version"></a>
  <a href="https://github.com/smithersai/vibelang/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/smithersai/vibelang/ci.yml?branch=main&logo=github&label=CI" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b949e" alt="MIT license"></a>
</p>

<h3 align="center">The programming language for agents.</h3>

---

VibeLang is a TypeScript-derived language for code that agents write and code
that runs agents. It keeps TypeScript's syntax and ecosystem, and makes the
things that go wrong in real systems visible to the compiler:

- **Expected failures are values.** A fallible function returns
  `Result<A, E>`. Inside it you write ordinary `return` and `throw`; the
  compiler lifts them. Callers propagate with postfix `!` or handle with
  `match`. Results are must-use, so a dropped error is a compile error.
- **Dependencies are capabilities.** `Users.context()` adds `Users` to the
  function's inferred requirement row. A `Layer` satisfies it at the edge. Tests
  provide an in-memory implementation without touching application code.
  Ambient host globals such as `process`, `fetch`, and the clock are not in
  scope; they arrive as capabilities too.
- **Compile-time is deterministic.** `comptime(...)` evaluates hermetically with
  tracked inputs, derives validators and schemas from ordinary types, and loads
  typed assets through import attributes.
- **Durable execution is compiled in.** Pass an ordinary function to
  `durable(...)` and its Action calls are journaled, so a crashed run resumes
  instead of repeating. The compiler publishes an Effect Manifest describing
  what the Flow may request, without ever executing it.
- **Foreign code is a checked boundary.** Calling unannotated TypeScript or
  JavaScript adds the distinguished `panic` case to the failure row; a trusted
  `@throws {never}` annotation removes it.

```ts
import { Context } from "vibelang/context"

class NotFound extends Error {
  constructor(readonly id: string) {
    super(`User not found: ${id}`)
  }
}

abstract class Users extends Context {
  abstract find(id: string): User | undefined
}

function getUser(id: string): Result<User, NotFound> {
  const user = Users.context().find(id)
  if (user === undefined) throw new NotFound(id)
  return user
}

function displayName(id: string): Result<string, NotFound> {
  const user = getUser(id)!
  return user.name
}
```

The return type tells the whole story: `User` on success, `NotFound` on
failure, and a `Users` requirement that must be provided before `displayName`
can run.

## Install

```bash
npm install --save-dev vibelang
npx vibe init          # writes tsconfig.json and main.vibe
npx vibe run main.vibe
```

Also available with `pnpm add -D vibelang` and `bun add -d vibelang`. VibeLang
needs Node.js 22.12 or newer (also required by the bundler integration). Use a
maintained patch release: early 22.x builds
enabled a V8 tier that Node disabled in 22.9.0 after correctness problems;
22.4.1 has also stalled during our CLI shutdown tests. See the
[Node 22.9.0 release note](https://nodejs.org/en/blog/release/v22.9.0#disable-v8-maglev).

VibeLang source lives in `.vibe` files. Imported `.ts` and `.js` modules keep
their ordinary TypeScript and JavaScript behavior, so you can adopt it one file
at a time inside an existing project.

### Compiler command names

The package publishes `tsc` alongside `vibe`, `vibec`, and `vtsc`.
`vibec` runs ordinary TypeScript command-line compilation inside the same pinned
Go executable used by the language. It preserves upstream CLI flags and does
not load a separate TypeScript compiler package. If a project depends on
both `vibelang` and `typescript`, npm links exactly one of them into
`node_modules/.bin`, with no warning, so `tsc` in a script may silently become
the VibeLang package's command. Depend on only one of the two, or call the
unambiguous names: `vibe` for VibeLang, `vibec` for native TypeScript command
compatibility, and `node node_modules/typescript/lib/tsc.js` for stock TypeScript
when you have separately installed that package.
Use `vibe lsp` for the VibeLang editor protocol. The old `tsserver`/`vtsserver`
launchers ran TypeScript 5.9 and are no longer shipped.

### Native compiler embedding

The package root `vibelang` and `vibelang/compiler` expose the same thin binding to the
pinned TypeScript 7 Go compiler. `NativeCompiler.compile()` accepts explicit
project sources and returns diagnostics and base64-encoded output artifacts;
it does not expose TypeScript 5.9 AST or checker objects. A package built for
your platform includes the native executable, so compilation needs no local
Go toolchain or source checkout.

```js
import { getNativeCompiler } from "vibelang"

const compiler = getNativeCompiler()
const result = compiler.compile({
  rootNames: ["main.vibe"],
  files: [{ path: "main.vibe", kind: "vibelang", text: "export const answer = 42" }],
  lowering: "internal",
})
```

CommonJS hosts can use `await import("vibelang")`. The root no longer returns
the TypeScript 5.9 module: `createProgram`, checker/AST objects, the old
`typescript`/`tsserverlibrary` aliases, and pass-through plugins are retired.
The `unstable/*` stock TypeScript client/AST re-exports are retired too: those
could select a different compiler or run a JavaScript scanner. Use the pinned
compiler's `inspect`, `tokenAt` and `format` requests for source tooling.
Use explicit native requests instead; `compiler.identity` names the exact
compiler revision and protocol. This is a pre-alpha compiler API migration,
not a change to authored language syntax.

The high-level language and durable frontends now use native Go requests too;
there is no TypeScript 5.9 compiler implementation or fallback. JavaScript hosts
marshal requests, validate data artifacts and run emitted code. The current
migration checkpoint and pending release verification are recorded in
the Go migration ledger (`compiler/GO-MIGRATION.md` in the source repository).

`analyzeSource`, `analyzeProject`, `parseErrors` and `parseFunctions` now query Go.
Their optional `rootDir` bounds native import discovery; project analysis keeps
the authored module set explicit. Durable source queries accept explicit Action
and child-Flow contracts; executable-body compilation uses the same native
checker and lowering. See the native contracts in the published
`vibelang/compiler` type declarations.

### Bundler integration

`vibelang/unplugin` exposes `.vite`, `.rollup`, `.rolldown`, `.webpack`,
`.rspack`, `.rsbuild`, `.esbuild`, `.farm`, and `.bun` factories backed by the
same Go compiler and project pipeline as the CLI:

```js
import vibelang from "vibelang/unplugin"

const plugin = vibelang.esbuild({
  root: process.cwd(),
  entries: ["src/main.vibe"],
  target: "node-es2022",
})
// Put plugin first in your host's plugins list.
```

Checked mode is the default and `entries` names the complete checked root set.
The plugin returns JavaScript and authored maps in memory, tracks imported rows,
assets and comptime inputs, and leaves ordinary TypeScript/JavaScript to the host.
The conservative `transform-only` mode refuses non-compiler module dependencies.
Bun's adapter requires Bun 1.2.22 or newer. Execution coverage is Node/Bun;
browser runtime support and durable Plan delivery are not implied. See the
[bundler guide](https://vibelang.sh/guide/bundlers) for host behavior and limitations.

## Get started with an agent

Paste this into whatever coding agent you use:

```
Read https://vibelang.sh/llms-full.txt to learn how VibeLang works.
Then set it up in this project: install `vibelang`, run `vibe init`,
and walk me through what each part does.
```

`vibe skills add` installs the VibeLang skill into your agent's skill directory,
and `vibe mcp add` registers the toolchain as an MCP server.

## Toolchain

One `vibe` command carries the toolchain: `check`, `compile`, `run`, `test`,
`inspect`, `plan`, `format`, `lsp`, and `doctor`. Run `vibe --help` for the
list and `vibe doctor` to see which surfaces are implemented on your machine.
The [CLI reference](https://vibelang.sh/reference/cli) has the contract.

## Status

VibeLang is in **alpha**. The language contract is written down before it is
implemented: the [documentation](https://vibelang.sh) is the product
specification, and [Specification Status](https://vibelang.sh/specification/)
says which rules are locked, which are directional, and where the shipped
compiler is known to be behind or ahead of the text. The
[decision ledger](https://github.com/smithersai/vibelang/blob/main/docs/DECISIONS.md) records the accepted decisions behind the
contract, and the [changelog](https://github.com/smithersai/vibelang/blob/main/CHANGELOG.md) tracks what ships.

## Contributing

Issues and pull requests are welcome at
[smithersai/vibelang](https://github.com/smithersai/vibelang). Start with
[CONTRIBUTING.md](https://github.com/smithersai/vibelang/blob/main/CONTRIBUTING.md) for the repository map and the gate sequence,
and [SECURITY.md](https://github.com/smithersai/vibelang/blob/main/SECURITY.md) for how to report a vulnerability.

## License

[MIT](LICENSE)
