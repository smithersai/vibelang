### 28. Tooling

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```sh
bun create vibelang my-app        # or: npm create vibelang@latest my-app
cd my-app
bun run build
bun run start
bun run test
bun run dev
bun x --no-install vibelang --noEmit
```

VibeLang 0.0.11 installs from npm as unscoped packages: `vibelang`,
`vibelang-runtime`, `vibelang-vite`, `vibelang-unplugin`, `create-vibelang`,
and one `vibelang-<os>-<cpu>` package per platform. `create-vibelang` copies
the starter, pins the VibeLang packages to its own version, and installs
dependencies (`--no-install` skips that). Projects need at least Node 26 and
Bun 1.4. The compiler is a native binary: `vibelang` lists each platform's package
as an optional dependency, and the package manager installs the one that
matches the machine (the per-platform distribution D30 planned):

| Platform | Package | Rehearsed for 0.0.11 |
| --- | --- | --- |
| macOS on Apple silicon | `vibelang-darwin-arm64` | No |
| macOS on Intel | `vibelang-darwin-x64` | No |
| Linux on x64 | `vibelang-linux-x64` | Yes |
| Linux on arm64 | `vibelang-linux-arm64` | No |

Version 0.0.11 publishes four native packages for macOS and Linux on arm64 and x64. Native Windows binaries are not available yet. Use WSL and follow the Linux instructions.

To work on VibeLang itself, install from a checkout. `sh scripts/setup.sh`
needs Go, Bun, and Node on PATH (tested: Go 1.26 with Go 1.27 downloaded
automatically, Bun 1.4.1, and Node 26.10). Setup builds
`packages/compiler/native/vibelang`, installs and builds the runtime, and copies
`templates/app` into `~/.bun-create/vibelang`, a local template that
`bun create vibelang` prefers over the npm package. That template has absolute
`file:` dependencies on the checkout's compiler and Vite packages and on the
runtime tarball setup packs (D120), so keep the checkout. After updating it,
rerun setup, then run `bun update vibelang-runtime vibelang vibelang-vite` in
projects created from it.

Setup links `~/.local/bin/vibelang` when that directory is already on PATH and
no unrelated executable occupies the path; project scripts find their own
compiler without it. Setup preserves unrelated templates and never edits shell
configuration.

#### Packages and versions

| Package | Current implementation |
| --- | --- |
| `vibelang` | Compiler and language server: a Node launcher that forwards arguments, streams, signals, and exit status to the matching platform package's native binary (`VIBELANG_BINARY` overrides it), plus the VS Code extension, the Node loader `vibelang/register`, and `vibelang/project`, the whole-project compile the loader and the bundler plugins share, with its on-disk cache (D299) |
| `vibelang-<os>-<cpu>` | The native `vibelang` binary for one platform |
| `vibelang-runtime` | Continuation kernel, prelude, and generated-code helpers; its README gives the ABI |
| `vibelang-vite` | Whole-project compiler subprocess integration for Vite 7 and 8 and Vitest 5 |
| `vibelang-unplugin` | Per-module compiler integration for webpack, Rspack, Rollup, Rolldown, esbuild, and Bun |
| `create-vibelang` | Scaffolds the starter for `bun create vibelang` and `npm create vibelang` |
| VS Code extension | Ships inside `vibelang` as `editor/vibelang.vsix`; not on the VS Code Marketplace or Open VSX |

The starter pins `effect`, `@effect/platform-node`, and `@effect/vitest` to
4.0.6, and Vitest to 5.0.5. The runtime checks Effect's version on load. The
compiler is the TypeScript 7.1 checker, with ordinary TypeScript semantics for
`.ts` files (D30), and emits ordinary `.d.ts` declarations, a `.ts` source's included, which need no VibeLang type to keep a call's reading (D458).

`vibelang` accepts TypeScript compiler flags: bare `vibelang` checks and emits,
`--noEmit` checks, `--watch` watches, and `-b` builds references. The same
native binary exposes `--lsp --stdio` and the upstream `--api` transport. The
Vite plugin compiles in a subprocess, not yet through the API transport (D105,
amending D31).

A whole-project compile is cached on disk (D299). The next process that loads
the same project reuses the result while the compiler, the configs, the scanned
directories, the installed packages, and every file the compile read are
unchanged; `VIBELANG_CACHE_DIR` moves the cache and `VIBELANG_DISABLE_CACHE=1`
turns it off.

#### Building and testing

The starter's configuration emits Node ESM into `dist/`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmitOnError": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.vibe"]
}
```

`build` runs `vibelang`. `start` builds and runs Node with `--enable-source-maps`.
`dev` builds once, then runs the compiler watcher and Node output watcher;
Ctrl+C stops both. To emit declarations, a library adds `declaration` and
`declarationMap`; the starter leaves them off.

Import local sources as `./welcome.vibe` or `./format.ts`; the compiler emits
`.js` specifiers and declarations that name `.js` outputs (D31). In `.ts`,
`./welcome.js` resolves to `welcome.vibe`. The starter's include glob selects
only `.vibe` sources; imported `.ts` integrations join the program too.

A `.vibe` file that belongs to another package, such as a workspace package a project imports as source, compiles with that package's own VibeLang settings, its trusted packages and diagnostic categories, as its own build would compile it (D297).

A loader's compile, for `vibelang/register`, `vibelang/bun`, or a bundler plugin, type-checks and emits only the files under its project's directory (`vibelang --loader-root`). Another workspace package's source in that program supplies types, and that package's own compile checks it, so a cold start checks each package once instead of once for each package that imports it.

The starter tests source files through the Vite plugin:

```ts ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  test: { include: ["src/**/*.test.vibe"] }
})
```

Register `it.effect` from `@effect/vitest` at the top level or in `describe`
(D38). Effect's packages are trusted, so call `assert` from `@effect/vitest`
directly: a failed `assert.strictEqual(actual, expected)` is a defect that
fails the test. Put another library's assertions in a hatch, with the values
as inputs: `sync((actual) => check(actual), actual)`. `bun run test` needs no
prior build and maps assertion failures to `.vibe` lines.

For a Vite application, add the same plugin to `vite.config.ts`. It runs one
compiler subprocess for the project, shared by requests, on the first request
and after source changes. It emits JavaScript and source maps into its own
directory under `node_modules/.vibelang/`, reports errors in the terminal and
overlay, and after an edit invalidates every loaded `.vibe` module and its
importers. It doesn't compare exported contracts yet. Sources must stay under
Vite's root so emit paths and source maps agree (D107). Its README documents
the `project` and `compiler` overrides.

#### The editor

The server is the fork's own, `vibelang --lsp --stdio` from the project's
compiler (D32). With `--version` the same binary identifies as
`VibeLang 0.0.11 (TypeScript 7.1.0-dev)`; there is no separate compiler entry
point (D75). Install the extension, which `vibelang` ships as
`editor/vibelang.vsix`, from a project:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
# Or use cursor --install-extension with the same path.
```

Open the project directory so the extension finds its local compiler, and
reinstall the extension after updating `vibelang`. In a checkout, setup also
builds the extension and prints its path.

The extension looks for `vibelang` in `vibelang.server.path`, then the nearest
`node_modules/.bin/vibelang`, then PATH, and requires a trusted workspace
(D79). Its grammar reuses VS Code's TypeScript grammar under `source.vibe`,
with inner `.ts` scopes so existing themes apply.

For the server to own `.ts`, disable VS Code's built-in TypeScript extension or
use Cursor's `useTsgo` setting (D76). While the built-in extension is active,
this one serves `.vibe` and leaves `.ts` to it. Don't set
`typescript.validate.enable` to false: this server reads that setting too and
would hide its VibeLang diagnostics.

In other editors, configure the LSP client for `.vibe` and `.ts` with
`tsconfig.json` as the root marker, and disable any other TypeScript server for
the project. For GitHub highlighting, add `*.vibe linguist-language=TypeScript`
to `.gitattributes`.

The tree-sitter grammar follows TypeScript's quoted-string syntax: an unescaped
line break is a syntax error; an escaped line continuation is allowed.
The contextual name `error` remains a name in a block-param call such as `error{}`.

Editor features (TypeScript files keep TypeScript's hover behavior):

- Hover shows a running call's success value as "Runs here and returns `T`",
  and whether a function is plain or an Effect function, with the return
  annotation that makes it plain (D77, D500).
- Prelude names and service members complete in scope (D78).
- A method of an Effect data type hovers as the function it calls, "Method
  syntax: calls `Option.getOrElse(maybe, …)`", and completes after a dot
  (D152).
- A program written as a function, `() => …`, or as a keyword form's operand
  hovers as a program; a pipe topic hovers as its value, "(topic) %: T".
- A layer's hover lists what it provides, needs, and fails with; `wire`'s
  hover, the order it builds its layers in. A `Duration.Input` string, the name
  in `Schema.brand("…")`, and the codes of an `@vibelang-diagnostics` comment
  complete (D246).
- Quick fixes cover retired spellings and the EK48xx rules whose repair is
  mechanical (D240).
- Refactors, code actions of kind `refactor.rewrite` (D245): write or remove a
  function's contract; convert an interface to a `schema` declaration; convert
  an `async` function to a VibeLang function, with or without an `error`
  declaration per `await`; convert nested calls to a `|>` pipe and back; toggle
  `x.pipe(f)` and `pipe(x, f)`.

D33's control-class hover text and catch-specific completions remain design
targets. Diagnostic messages include repair suggestions as text; the compiler
does not implement those editor refactors.

#### Diagnostics

Before EK4801, ten EK codes are warnings by default. Five mark retired spellings that still compile the same, each with a quick fix: EK1009, EK2112, EK2113, EK2120, and EK2121. Four are policy diagnostics: EK1012, EK1016, EK2004, and EK2129 (D504). EK4406 marks deprecated trust tags (D249). EK4408 also warns for a module name that collides with a value binding, while its other forms are errors (D303). Every other code before EK4801 is an error by default, EK2119 and EK3205 included (D351, D420).

A project may set EK1012, EK1016, EK2004, EK2129, EK3205, EK4403, EK4406, and EK4409 to `"error"`, `"warning"`, or `"off"` in the `vibelang` setting `diagnostics`. EK3205, EK4403, and EK4409 are errors by default (D321, D420). EK9100 is an error that no setting lowers: a renderer that cannot give a program the compiler's meaning rejects it (D366, D416). An EK4403 read allowed this way compiles as a trusted `sync` call that tests cannot control, and an EK4409 call allowed this way returns the unrun program. Retired codes keep their numbers unused: EK1014, whose `!` form D309 restored; EK1008, since a pipe's topic is always a value (D325); and EK2115 and EK2116, since annotations no longer make factories (D323).

An error marks code with no meaning, or whose generated output would break a rule of Parts II and III, so none can be lowered. `// @ts-expect-error` does not suppress EK errors; it keeps its TypeScript meaning for TypeScript's own codes.

EK4801-EK4825 carry the rules of Effect's language service that VibeLang's syntax does not already rule out (D240). They are lint, not soundness: each has a default category (error, warning, or off), and each except EK4813, which stands in for TypeScript's TS2339, can be set in the `vibelang` setting `diagnostics` or by a comment (D241):

```ts
// @vibelang-diagnostics EK4818:warning            from here to the end of the file
// @vibelang-diagnostics-next-line EK4801:off       the next line only
// @vibelang-diagnostics *:off                      every adjustable code
```

EK4838 is the exception in this range: it reports a fiber that would be interrupted before anything outside its block could use it, an error that no setting lowers (Chapter 7). EK4830-EK4837 mark Effect code written the way Effect's TypeScript writes it where VibeLang has a form of its own (D284-D290): an error class (EK4830, or EK4837 for a Schema error class), a `Context.Service` class, a constant that holds a `Schema.Struct`, an `Effect.Effect<A, E, R>` type, a running `Effect.succeed` or `Effect.fail`, a catch combinator, and `Effect.withSpan`, `Effect.provide`, or `Effect.provideService`; EK4839 marks a choice written with Effect's `Match` functions, which a `match` expression writes (D472), EK4840 a pipeline of the `Option` module's functions, which Option's methods write (D473), and EK4841 a schema constant just after its type alias, which a schema alias writes (D474), and EK4842 an import of one of Effect's modules under the name of a JavaScript global, which VibeLang keeps for the global (D475), and `EK4843` a `const` or `let` named `main` that holds a function, which no host starts, where `export function main()` is the entry (D498). They are lint too, warnings by default and adjustable the same way, and they never change emit or the exit status. Each has a quick fix wherever the VibeLang form keeps the program's meaning; where it would not, the warning says what would change and offers none. `vibelang -p tsconfig.json --fix` applies every such fix, the quick fixes of the retired spellings, and EK1002's, which writes an `Effect.gen` program in direct style (D470), to a project's own `.vibe` files, the ones tsc would emit for it and not a dependency's source that a package import reaches, and then compiles as the rest of the command line says. Each fix keeps the program's meaning by the rule below; as a second check, `--fix` writes a file only when the fixed program reports no error the original did not (D291).

A later comment overrides an earlier one; within one comment, a code named on its own overrides `*`. D266 supersedes D242: every EK diagnostic is restricted to `.vibe` files, and ordinary TypeScript sources keep TypeScript diagnostics whatever these settings say.

| Option in the tsconfig's top-level `vibelang` object, or `compilerOptions.vibelang` (D275) | Values | Default |
| --- | --- | --- |
| `diagnostics` | `"EK1012"`, `"EK1016"`, `"EK2004"`, `"EK2129"`, `"EK3205"`, `"EK4403"`, `"EK4406"`, `"EK4409"`, EK4801-EK4825 except `"EK4813"`, EK4830-EK4837, `"EK4839"`, `"EK4840"`, `"EK4841"`, `"EK4842"`, and `"EK4843"`, each `"error"`, `"warning"`, or `"off"` | EK1012, EK1016, EK2004, EK2129, and EK4406 `"warning"`; EK3205, EK4403, and EK4409 `"error"`; EK48xx as the table below says |
| `tracing` | `"none"`: no spans. `"exported"`: exported functions get `Effect.fn` spans. `"all"`: every named lowered function and method gets a span; anonymous lambdas don't (D104) | `"none"` |

`vibelang` exits non-zero when it reports any error. The CLI prints `error EK1003:`; LSP sends source `EK` and numeric code `1003`, which VS Code displays as `EK(1003)` (D61). In the terminal, the editor, and Vite's overlay, diagnostics print at `.vibe` spans in the form this document's examples use.

The diagnostic registry reserves these codes; the table gives each rule and its
intended repair (D33, D53). A registry entry doesn't prove its check or editor
code action is implemented; the acceptance suite and compiler README track
coverage. Repairs are suggestions, not shipped code actions:

| Code | What it reports | Suggested repair | Chapter |
| --- | --- | --- | --- |
| EK1001 | A module's top level runs a program, or a throw can escape it; a class field's initializer or a default parameter value runs a program or can fail, a throw expression in a parameter default included; or a constructor, an accessor, or a static block runs a program; each runs as plain JavaScript (D282, D350). A call of a plain function whose return type is not definitely an Effect runs no program in any of them (D445); one whose return type is runs the Effect it returns, and is EK1001 there (D480); a call of an unannotated function is a call of an Effect function, whatever its body (D500); and a failure that can escape a constructor, an accessor, or a static block is EK2003 (D455) | Write the callee's return type, `: T` or `: infer _`, which makes it plain (quick fix, where its body performs no Effect operation); export a function instead; compute the value in an Effect function; store a program as a function, `() => call()` | 13 |
| EK1002 | A `function*` passed to an API whose parameter returns a library Generator or Iterator, such as `Effect.gen` (D64), or a `function*` whose return annotation is a JavaScript iterator type: a `function*` is a producer (D370) | Convert the function: for `Effect.gen`, a quick fix writes the body in direct style where that keeps the program's meaning (D470); write a JavaScript generator as a generator method, or in a `module` declaration or a `.ts` file | 8, 10 |
| EK1003 | `async`, `for await`, or `await using`, and `await` inside an `async` function, outside a hatch or a `module` body (D283): a call already waits | Remove them. Use `join` for a fiber or a hatch for a promise (D225, D226) | 10 |
| EK1004 | `using` at a module's top level or in a class static block | Move it into a function | 6 |
| EK1005 | A runner inside code that a fiber runs | Call the program; `detach(() => p())` to let it outlive this fiber, as a root would | 13 |
| EK1006 | A pipe whose body does not use its topic, as in `name \|> "anonymous"` (D156) | Write `%` where the value goes: `name \|> greet(%)` | 5 |
| EK1007 | `%` outside every pipe's body (D156) | Use `%` only after `\|>`; `%` between two operands is still the remainder | 5 |
| EK1008 | Retired: a pipe's topic is always the value of its left side, so no pipe passes its left side to one program and uses it as a value too (Chapter 5). The number is not reused | | 5 |
| EK1009 | Warning: a `provide` block written with its old keyword, `with` (D172) | Write `provide`; the quick fix replaces the keyword | 4 |
| EK1010 | An unparenthesized throw expression is, or ends, a binary operator's left operand (except comma), a conditional's condition, or the operand of `as` or `satisfies`, as in `x ?? throw c ? a : b` (D186) | Write `throw (…)` to throw the whole expression | 3 |
| EK1011 | A function compiles to an Effect, but the program cannot find effect's Effect type, because `effect` is not installed where the program resolves it (D4) | Install `effect` | 15 |
| EK1012 | Warning: a call that runs and never succeeds is stored in a variable, a field, an element or an assignment, which then never holds a value | Store a function, `() => call()`, or write the call as a statement | 13 |
| EK1013 | A comma after a field of an `error`, `schema error`, `service`, or `control` declaration, whose body is a class body (D278, D128), or after a variant or a variant's field of a `data` declaration, which separates them the same way (D307) | Write `;` or start a new line (quick fix) | 3, 4, 9, 11 |
| EK1015 | yield* outside a generator | Remove yield*: calls already run and return their success values | 13 |
| EK1016 | Warning: an otherwise valid module defines a zero-argument, unexported `main` that nothing references | Write `export function main()` to start it when this module runs | 13 |
| EK1017 | `provide` used as an expression instead of a statement | Write `provide layer { statements }` and return from inside its block | 4 |
| EK1019 | A `var` declaration inside a `do` expression, or a `break` or `continue` that would leave it (Chapter 13, D327) | Replace `var` with `let` (quick fix); keep jumps inside the `do` expression | 13 |
| EK1020 | `new` on a function declared in a `.vibe` file, which is not a constructor, in place of TypeScript's TS7009; a cast or `@ts-ignore` does not hide it (Chapter 13, D327) | Declare a class, or call the function without `new` | 13 |
| EK2001 | An expected failure escapes the written contract | Catch it, widen the contract, or `Effect.orDie` | 2, 14 |
| EK2002 | A requirement escapes the written contract | Widen the contract, or provide the service | 14 |
| EK2003 | A plain annotation on a function or method whose body runs an Effect, other than by calling a plain function whose return type is not definitely an Effect (D67, D74, D445, D480), a call of an unannotated function included (D500), or a plain annotation on a function, or a generator method, whose throw or trusted call's listed failure can escape (D399), or a throw or listed failure that can escape a constructor, an accessor or a class static block, which run as plain JavaScript (D282, D370) | A quick fix writes the Effect contract with the channels the body adds, such as `T!!`, `T!!Users`, or `T!Invalid!`; or remove the annotation; for an escaping throw, `die(error)` under `T!!` makes it a defect, or move the throw to a `.ts` file, a `module` block, or a `sync` hatch under `T!!`; or catch it in the function | 14 |
| EK2004 | Warning by default: a catch whose try block has E = `never`, in an Effect or a plain function, or a catch expression with no expected errors; defects, JavaScript exceptions included, pass through (D238, D260, D282). Also, in a plain function whose try block can fail, a call whose exception passes through the catch as a defect: an Effect export that the shipped contracts list as throwing defects, resolved by symbol, never by its name (D282, D328); an untrusted TypeScript function is EK4401 instead (D329) | Use the form that can fail, `try`, or `Result.try` | 3 |
| EK2005 | A `resumeWith` program that needs a service or fails outside the operation's contract | Read the service in the clause first | 9 |
| EK2006 | A `return`, `break`, or `continue` that leaves a `finally` block, which in JavaScript discards the failure in flight | Move it after the `try` statement | 17 |
| EK2101 | A service or control method without a body whose return type is not an Effect type (D93, D308, D309) | Write `T!Errors!Dependencies`, or `T!!` | 14 |
| EK2102 | A recursive Effect function whose success, catch-variable, or return type needs a contract before its cycle's channels are known (D71, D72) | Write the contract | 14 |
| EK2103 | A member of a `service` or `control` declaration with a body or an initializer (D128), or any instance member of `service Name: Type` (D281) | Implement it in a layer, declare it in the shape, or make it static | 4 |
| EK2104 | A setup statement of an old `layer` declaration that follows one of its members (D129) | Move the statement above the members | 4 |
| EK2105 | A retired typed catch clause whose type has a member without a literal `_tag` (D131) | Catch a tagged error, or test the value in an untyped clause | 3 |
| EK2106 | A retired catch clause after one that catches every failure: an untyped clause or a `Cause` clause (D131, D176) | Move that clause last | 3 |
| EK2107 | A handle clause whose control is not a control declaration, such as a service (D132) | Provide a service with a layer; handle only a control's operations | 9 |
| EK2108 | A handle statement that leaves an operation of a control it handles without a clause, or gives one two clauses (D132) | Add the missing clause, or remove the second | 9 |
| EK2109 | A field of a `schema` declaration whose type has no schema form, or names a value that is not a schema (D133) | Declare the schema with `Schema.Struct`, or name a schema constant | 11 |
| EK2110 | A clause of a `handle(...)` call reads the result of a `resume` that is not its last step, while a clause or `onReturn` can produce a value outside that result's type: the program's result type, or `never` with `onReturn` (D97) | Return the program's type from every clause, or return the result unread | 9 |
| EK2111 | A `restore` block that no `uninterruptible` block of the same function encloses (D180) | Put it inside `uninterruptible { … }`, or use `interruptible { … }` | 6 |
| EK2112 | Warning: a catch clause that tests a failure's type, `catch (e: NotFound)`, including an expression handler, retired (D216) | `catch (e)` and test `e` with `match` or `is`; the quick fix rewrites the clauses | 3 |
| EK2113 | Warning: a catch clause typed `Cause`, retired (D217) | `match (exit(…))` with `Exit.Success` and `Exit.Failure` arms; the quick fix rewrites `try { return X } catch (c: Cause) { return Y }` | 3 |
| EK2114 | A catch expression, `x catch y` or `x catch (e) => …`, inside a hatch body, which is plain TypeScript (D239) | Move the catch out of the hatch, or use a try statement inside it | 3 |
| EK2115 | Retired: an annotation no longer makes a function a factory (D323). The number is not reused | | 5, 13 |
| EK2116 | Retired with EK2115 (D323). The number is not reused | | 5, 13 |
| EK2117 | An error whose tag does not fit: a subclass whose base's tag type does not include the subclass's name, a concrete error whose `_tag` field's type does not include its own name, an error that extends a class that is not an error, a `schema error` that extends an error that is not one, or an `error` that extends a `schema error` (D278, D279, D304) | Give the base the field `_tag: string`, or declare it `abstract`; give a `_tag` field a type that includes the error's name; extend an error of the same kind | 3 |
| EK2118 | A subclass that declares fields and no constructor, whose base's constructor takes something other than one object of fields (D278) | Write a constructor that calls `super` with what the base takes and sets the fields | 3 |
| EK2119 | A `return` of a handle statement's clause that some path reaches after a non-tail `resume` of that clause returns a value the handler's answer type does not include, so a `resume` still waiting could receive a value outside its type; an error (D97, D351, D410) | Write the enclosing function's success type to include it | 9 |
| EK2120 | Warning: a `service class` or `control class` declaration, the old spelling (D223) | Write `service` or `control` without `class`; the quick fix removes `class` | 4 |
| EK2121 | Warning: a `layer` declaration, the old spelling (D221) | Write `Layer.effect(Service) { … }` or `Layer.succeed(Service, { … })`; the quick fix rewrites it | 4 |
| EK2122 | A `data` declaration without variants (D307) | Write at least one variant | 11 |
| EK2123 | A `data` declaration that declares a variant twice (D307) | Rename one, or remove the second | 11 |
| EK2124 | A name `Data.taggedEnum` reserves: a variant named `$is` or `$match`, a variant's field named `_tag`, or another declaration in scope of a generic data type's `NameDefinition` (D307) | Rename the variant, the field, or the other declaration | 11 |
| EK2125 | A member of a `data` variant that is not a field: a method, an index or call signature, a field without a type, or a `mutable` field (D307) | Write `name: Type` or `name?: Type`; a variant's fields are readonly | 11 |
| EK2126 | A `data` declaration with more than four type parameters, or a constrained one, which `Data.TaggedEnum.WithGenerics` cannot pass (D307) | Use at most four unconstrained type parameters | 11 |
| EK2127 | `Name.Variant` where `Name` is a data type without that variant, in a call, a pattern, or anywhere else; it replaces TypeScript's TS2339 (D307) | Name one of the variants the message lists | 11 |
| EK2140 | A `throw` whose operand's type is a Cause type, or a union with one, which would fail with the `Cause` object itself (D406) | `Effect.failCause(cause)` to fail with every reason | 3, 17 |
| EK3001 | Two services share a key | Rename one | 4 |
| EK3002 | A class extends a service | Replace `extends` with `implements` | 4 |
| EK3003 | `new` on a service | Use `Users()` for the implementation | 4 |
| EK3004 | `instanceof` on a service | None: a service is a key, not a base class | 4 |
| EK3005 | A generic service class | Use an interface for the generic type | 4 |
| EK3006 | A static member with the same name as a service member | Rename one | 4 |
| EK3007 | A service key called with arguments, as `Fn(3)` for `service Fn: (n: number) => number`, in place of TypeScript's TS2348, whose suggestion of `new` would be EK3003; `S()` takes none and returns the implementation (Chapter 4, D415) | `Fn()(3)` (quick fix, for an implementation that is a function) | 4 |
| EK3101 | A provider looks a service up per call where the contract allows no requirements | Capture the service when the layer is built, or declare it | 4 |
| EK3201 | No provider for a required service, with the path that needs it | Add the provider the program defines to `wire` | 4 |
| EK3202 | Two providers for one service | Remove one | 4 |
| EK3203 | Providers form a cycle | None | 4 |
| EK3204 | A `wire` argument whose type does not name its outputs, or a spread argument whose layers `wire` cannot list one by one | Compose it with `Layer.provide`, or pass each layer as an argument | 4 |
| EK3205 | An entry module's `main` needs a service that nothing provides when the host starts the module, the layer of the file's platform import included (D312); it names the layer that provides each of Effect's and the experimental services, as EK4402 does, and the platform import that would provide them; an error by default, adjustable, since the program would die with `Service not found` (D420); whether it is reported depends on the entry file alone, never on another module's imports (D387) | Provide it inside `main` with `provide`, or add the platform import | 4 |
| EK3206 | A file names a second, different platform with a platform import, as `import "vibelang/platform/node"` then `import "vibelang/platform/browser"` (D312) | Keep the import of the platform the file runs on | 4 |
| EK3207 | A provider that is not a layer, a non-empty list of layers, a `Context`, or `Key = value`, such as a value of an array type that may be empty, a union with a member of another kind, or `any`; an error that no setting lowers (D362) | Provide a layer, a non-empty tuple of layers, or a `Context` | 4 |
| EK4201 | A control operation inside a combinator that runs it on another fiber, or a `Stream` whose R holds one where it reaches a consumer other than `for...of`, which pulls a producer on the adapter's fiber (D402) | Handle the operation inside the branch or the producer, or consume the producer with `for...of` | 8, 9, 16 |
| EK4202 | A TypeScript function whose R holds a control operation | None in v0 | 9 |
| EK4301 | An Effect function where only a plain function fits (D430, D500): a function literal at a destination of the plain form whose body can pause, or let a `throw` or a trusted call's listed failure escape, a call of an unannotated function included, whatever overload or contextual type made the destination plain (D392, D399, D482, D494); an Effect-annotated literal there; a function value whose type returns a definitely-Effect type, an unannotated function and one with an Effect contract alike, whatever its body (D421); a protocol method, or a method implementing a plain member, whose body can (D55, D397); an object, a class instance, an array, or a function whose signature or method returns an Effect where TypeScript checks it against a plain function type (D430); and a call of a union callee whose members differ in form (D454) | Write the function's return type, `: T` or `: infer _`, which makes it plain (quick fix, where its body performs no Effect operation); rewrite as `Effect.forEach` or `for...of`; catch the failure inside; where an overload or the destination accepts an Effect callback, write the literal's Effect return annotation, `(x): T!! => …` (quick fix); a visitor returning a program uses `() => () => call()` when its result is used | 10, 16 |
| EK4401 | Packages matching the `vibelang` setting `trustedPackages` are trusted (D261); otherwise, a plain TypeScript call in code a fiber runs, a function with a plain annotation included, with no boundary or trusted contract (D100, D329) | Export a `trusted(impl, [Errors])` value, which plain code calls through its implementation (D249, D400); in an Effect function, a `try` hatch | 10 |
| EK4402 | A Node.js global or a web global that does I/O, run or held as a value, or a Node.js module imported as a value (D310, amending D108); `import type` and imports in a `module` block are allowed | Use the Effect service the error names; for what Effect lacks, `Experimental`, a `module` block or a `.ts` file | 11 |
| EK4403 | Error by default: a clock or randomness read | Use `Clock`, `DateTime`, `Random`, or `Crypto` | 10 |
| EK4404 | `try` given Effect's `{ try, catch }` options object, which it would treat as a value | Pass the code and the error mapping as two arguments: `try((text) => parse(text), (error) => …, text)` | 10 |
| EK4405 | A hatch's TypeScript reads a binding the `.vibe` file declares outside the hatch: a local, a parameter, or a module declaration (D229) | Pass the value as an input, an argument after the function that fills its first parameter: `sync((bytes) => crypto.getRandomValues(bytes), bytes)`; the quick fix does this | 10 |
| EK4406 | A call whose D23-tagged TypeScript declaration changes the emitted failure contract: a warning in the compiler, while a renderer that reads one file at a time rejects such a call with EK9100 (D249) | Export a `trusted(impl, [Errors])` value beside the implementation and call that value | 10 |
| EK4407 | A module specifier written as an identifier, `from text`, names no module declaration of the file (D283) | Declare `module text { … }` at the file's top level, or import a file with a string specifier | 10 |
| EK4408 | A module declaration that is nested, exported, declared twice, or has no name (`module { … }`); `module` used for a namespace in a `.vibe` file; a module body that uses `export =` or `import = require()` (D283); a construct whose ECMAScript module semantics the lowering cannot keep, such as a direct `eval` that must see a renamed binding (D364); or a module name shared with a value binding of the file (warning, D303) | Keep module declarations named, at the top level and unexported, write namespaces with `namespace`, use ES module syntax in the body, and choose distinct module and value names | 10, 11, 26 |
| EK4409 | Error by default, adjustable: what an Effect function or a program returns is a call of a value of type `any`, so a program the callee returns never runs (D24, D321) | Give the callee a function type: one that returns `A!E!R` runs the program | 10 |
| EK4501 | A method of an Effect data type named without a call, as in `const f = stream.filter` (D153) | Call it, or pass `Stream.filter` itself | 13 |
| EK4502 | .pipe on a call whose success value has no pipe member | Pass the program as a function: `retry(() => call(), policy)` | 13 |
| EK4503 | A service implementation member read on its key, or on a module whose name names the service (`Path.sep`, D311), a member named like a property of the key's class, such as `name` or `length`, included (D388) | Read S().member; S.method(args) directly calls an implementation method, and S.member() runs a member that is a program | 13 |
| EK4601 | `await` before a call that already runs (D226) | Remove `await`; to run the call concurrently, fork it and join the fiber | 7 |
| EK4602 | `await` on a promise in VibeLang code (D226) | Wrap it in a hatch: `try(async () => …)` | 7 |
| EK4603 | `await` on any other value; VibeLang code has only the await operations (D226). Also an await operation's operand that is not a literal, whose element type is not a program, such as an `Exit`, a `Config`, or a union with a non-program member (D394) | Fork the program and join the fiber, or use `await.all`, `await.race`, `await.any`, or `await.allSettled`; for an operand, give its elements a program type | 7 |
| EK4604 | `await` in a hatch body that is not `async` (D226) | Make the hatch's function `async` | 7 |
| EK4605 | `break` that would leave a `for concurrent` loop (D169) | Use `continue` to end one item, or `throw` to stop every item | 7 |
| EK4606 | `return` in a `for concurrent` body (D169) | Use `continue` to end one item | 7 |
| EK4607 | `select`, which `await.race` replaced (D197) | Write `await.race [a(), b()]`; for a `default:` clause, poll with `Queue.poll` and an `if` | 7 |
| EK4608 | `await.race` or `await.any` on an object (D196) | Write the elements in an array: `await.race [a(), b()]` | 7 |
| EK4609 | `await` on a fiber, or an array or object of fibers (D226); also an await operation's element of `Fiber` type (D394) | Write `join` for `await` (quick fix); in an await operation, `join f` as the element | 7 |
| EK4610 | `await` on a Deferred (D226); also an await operation's element of `Deferred` type (D394) | Write `d.await()` (quick fix), as the element too | 7 |
| EK4611 | `join` on a value that is not a Fiber, an array or tuple of fibers, or an object whose every property and index signature has a Fiber type (D225, D354) | Join fibers; wait for a Deferred with `d.await()`; fork a program first | 7 |
| EK4612 | `join` in a hatch body, which is plain TypeScript (D225) | Move the `join` out of the hatch | 7 |
| EK4701 | A `match` without a `default` arm that may leave a value unhandled: over a finite union of concrete cases (literal types, data types and their variants, `Option`, `Exit`, `Result`, and tagged classes) a case no arm covers, naming a data type's variants as `Delivery.Sent`; over an open subject (an open error family's base, a class code anywhere may extend, a class that is not tagged, `unknown`, `any`, `object`, a type parameter, a non-literal `string` or `number`) any such match. A class arm over a tagged class removes every case its tag set covers; an arm over any other class removes nothing (D209, D307, D345, D346, D428, D515) | Add an arm for each case left, or a `default` arm, or narrow the subject's type to the union handled; in a `catch`, `default: throw e` | 3, 11 |
| EK4702 | A binding inside an `or` or `not` pattern (D210) | Bind outside the combinator, or match each alternative in its own arm | 3 |
| EK4703 | An `is` whose pattern binds names outside the condition of an `if` or `while` (D211) | Move the test into an `if` or `while` condition, or use `match` | 3 |
| EK4704 | A pattern form VibeLang does not support yet: regular expression, relational, or a computed key other than a name or literal (D212); or an array pattern whose subject's type admits an iterable that is not an array, which the lowering does not iterate (D417); or a guard, `if (e)`, that reads a binding a term after it binds (D520) | Use a guard: `if (/re/.test(x))` or `if (x < 5)`; for an iterable, spread it into an array first, `match ([...xs])` | 3 |
| EK4705 | `and`, `or`, and `not` combined at one level without parentheses (D206) | Add parentheses: `(a and b) or c` | 3 |
| EK4706 | A field list in braces after a matcher that is not a data variant, `when NotFound { let id }`, or an argument list after one that is, `when Delivery.Sent(let s)` (D307) | `when NotFound and { let id }`; `when Delivery.Sent { let tracking }` | 3, 11 |
| EK4707 | A data variant's pattern whose subject's declared type, a finite union, has no case with that variant's tag (D307) | Match a variant of the subject's type | 3, 11 |
| EK4801 | A statement that discards an Effect value, as `program` alone on a line, or names a program without calling it, as `interrupt` alone (D24); an error by default | Call it: `program()` (quick fix) | 2 |
| EK4802 | Error by default: an Effect value, a program, or a value whose union type holds one, returned where the success type names no value (`void`, `unknown`, `any`, or an unconstrained type parameter that the declared return type of the function receiving the callback does not mention, D436), written or contextual, so the caller gets it unrun; also an arm of a returned conditional or an operand of `??`, `\|\|` or `&&` (D241, D321); and a value whose type is definitely an Effect returned by an Effect function, wherever the function stands, unless its return annotation writes the nested Effect, as Effect's `returnEffectInGen` reports, an unannotated literal at a destination whose function type returns an Effect included, `flatMap(x, (v) => cached)` (D463, D480, D500); a returned function is not one under this last clause, though under the first a function with no required parameters is a program | Call it: `return program()` (quick fix), or write its type as the success type; a function that hands back a program it received writes a plain return annotation, `: infer _` | 2, 13 |
| EK4803 | Warning: the program loads two versions of `effect`, an `@effect/*` package, or `vibelang-runtime` | Install one version | 28 |
| EK4804 | Warning: a failure that is a global `Error`, thrown or returned by a `try` mapping | Declare it: `error Failed { message: string }` | 3 |
| EK4805 | Warning: a class that extends `Error` | Write an `error` declaration | 3 |
| EK4806 | Warning: a `try` mapping that returns `unknown` or `any` | Return an error declaration's instance | 3 |
| EK4807 | Warning: `Layer.mergeAll` of a layer that needs a service another argument provides | Write `wire` (quick fix) | 4 |
| EK4808 | Warning: a `provide` block that holds only another `provide` block | `provide A, B { … }`, or `provide wire(A, B) { … }` when one needs the other (quick fix) | 4 |
| EK4809 | Warning: a service whose every Effect member needs the same service | Read it where the layer is built, or mark it `@vibelang leakable` | 4 |
| EK4810 | Warning: an assertion from one Effect type to another that drops failures or services | Remove the assertion (quick fix) | 14 |
| EK4811 | Off by default: a throw of `any` or `unknown`, or a call that adds one to E or R | Throw an error declaration's instance; give the callee a contract | 3 |
| EK4812 | Warning: `new Promise` in VibeLang code | `callback((resume) => …)`, or an `async` hatch function that waits for it, given the promise as an input, `try(async (p) => p, (cause) => …, promise)` (D439, D456, D468) | 10 |
| EK4813 | An Effect 3 name of the Effect module, such as `Effect.catchAll`; it replaces TypeScript's TS2339 | Write the Effect 4 name, `Effect.catch` (quick fix, also for TS2339 in `.ts` files) | 11 |
| EK4814 | Warning: a constructor in a class that extends a Schema class, which decoding does not call | Add a static function that makes an instance | 11 |
| EK4815 | Warning: a throw of an Effect value | Run it: `program()` | 3 |
| EK4816 | Off by default: a layer provided outside a function named `main` | Provide layers in the entry module's `main` | 4 |
| EK4817 | Off by default: `instanceof` a Schema class | `Schema.is(Person)(value)` (quick fix) | 11 |
| EK4818 | Off by default: `JSON.parse` or `JSON.stringify` in VibeLang code | Decode with `Schema.fromJsonString` | 11 |
| EK4819 | Reserved historical D242 rule: `yield` of an Effect in an Effect generator; suppressed in TypeScript by D266 | Write `yield*` (quick fix) | 10 |
| EK4820 | Reserved historical D242 rule: `yield*` of an Effect that never succeeds, as a statement; suppressed in TypeScript by D266 | Write `return yield*` (quick fix) | 10 |
| EK4821 | Off by default: `Schema.Struct` with a `_tag: Schema.Literal(…)` field | `Schema.TaggedStruct("Opened", { … })` (quick fix) | 11 |
| EK4822 | Off by default: a condition whose type is not boolean | Compare explicitly: `if (count > 0)` | 2 |
| EK4823 | Off by default: an arrow function whose block only returns a value | Write the value as the body (quick fix) | 2 |
| EK4824 | Off by default: a `pipe` with no functions | Remove the pipe (quick fix) | 5 |
| EK4825 | Off by default: a pipe of a pipe, `x.pipe(f).pipe(g)` | Pass every function to one pipe (quick fix) | 5 |
| EK4830 | A warning: a class that extends `Data.TaggedError`, `TaggedError`, `Data.Error`, or `Schema.TaggedError` with an empty body (D284) | `error NotFound { id: string }` (quick fix when the tag is the name and the base is a TaggedError) | 3 |
| EK4831 | A warning: a `Context.Service<Self, Shape>()(key)` class whose shape is an object type (D285) | `service Users { … }` (quick fix when the shape is written in place), which keeps a key other than the derived one as `static readonly key = "…"`, so the declaration file is unchanged (D501) | 4 |
| EK4832 | A warning: a `const` that holds a `Schema.Struct` a `schema` declaration writes (D286) | `schema User { … }` (quick fix) | 11 |
| EK4833 | A warning: `Effect.Effect<A, E, R>`, which the `!` form writes in fewer tokens; the prelude's `Effect<A, E, R>` draws nothing (D287, D308, D309) | `A!E!R` (quick fix) | 2 |
| EK4834 | A warning: `Effect.succeed(x)` or `Effect.fail(e)` where the call runs (D288) | `x`, or `throw e` (quick fix) | 2, 3 |
| EK4835 | A warning: `Effect.catchTag`, `Effect.catchTags`, or `Effect.catch` in a VibeLang function (D289) | `x catch (e) => match (e) { when { _tag: "NotFound" }: …; default: throw e; }` (quick fix) | 3 |
| EK4836 | A warning: `Effect.withSpan`, `Effect.provide`, or `Effect.provideService` in a VibeLang function (D290) | `withSpan(() => …, "name")`, `provide Layer { … }` (quick fix) | 4, 24 |
| EK4837 | A warning: a class that extends `Schema.TaggedError` with an empty body, which an error declaration replaces only by dropping its Schema (D284) | `error Failed { … }` where nothing needs the Schema; turn the code off where errors are Schemas by design | 3 |
| EK4838 | An error, not adjustable: an owned fiber that goes, directly or through parentheses or a conditional's arms, anywhere but a `const` or `let` of its owning region, an array or object literal such a binding holds only to join (D469), `join`, the prelude's `interrupt`, a `Fiber` function whose result holds no `Fiber` and its methods, or a `fork` operand, await element, or `for concurrent` body in the same region: returned, alone or in an object or array; assigned to a binding or property declared outside the region; stored in a collection; passed to another call; or captured by a function literal or block param, one inside a `fork` operand included; a plain `await` of the fiber is EK4609 alone (D353, D386, D409, D455, D464, D469) | `Effect.forkScoped(() => p())` for the caller's lifetime, `forkIn(scope, () => p())` for a scope you hold, or `detach(() => p())`; to bound a `join`, race it as an await element in the same region, `await.race [join f, do { sleep(d); throw new Late() }]` | 6, 7 |
| EK4839 | A warning: a choice written with Effect's `Match` functions, `Match.value(x).pipe(…)`, `pipe(Match.value(x), …)`, or `Match.type<T>().pipe(…)`, that ends in `Match.exhaustive`, `Match.orElse`, `Match.orElseAbsurd`, or `Match.tagsExhaustive` (D472) | `match (x) { when "a": …; when { _tag: "B" } and let b: …; default: …; }`; the quick fix writes it when each pattern and handler has a form that tests and gives the same, and keeps the chain's type | 3 |
| EK4840 | A warning: `pipe(x, Option.f(…), …)` or `x.pipe(Option.f(…), …)` whose every stage is a function of the `Option` module (D473) | Method syntax: `x.map(f).getOrElse(g)` for an Option `x`, and `Option.fromNullishOr(x).map(f)` for another value (quick fix when each stage's arguments are functions, names, literals, or properties of names, and each stage has the data-first overload its call needs) | 11 |
| EK4841 | A warning: a schema constant other than a `Schema.Struct` whose type alias, `type X = typeof X.Type`, is the statement just after it (D474, D501) | The schema alias `schema X = <type>` (quick fix; a type written before its constant draws nothing, because the alias's declaration file lists the constant first) | 11 |
| EK4842 | A warning: an import that binds one of Effect's modules under the name of a JavaScript global, `Array`, `String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt` or `RegExp` (D475) | The import under another name, `import { Array as Arr }`, with every reference to it renamed (quick fix when no type is written with the import, and nothing the file exports names it or has a type the module declares) | 11 |
| EK4843 | A warning: an exported `const` or `let` named `main` that holds a function without parameters, which no host starts, since only a function declaration named `main` is an entry (D135, D498, D502, D517) | `export function main() { … }` (quick fix where the declaration means what the function means) | 13, 28 |
| EK9100 | A renderer other than the compiler, such as the text projector, which reads one file at a time without types, cannot give a program the compiler's meaning, such as a function's form or whether a call runs; an error in every renderer, which no setting lowers (D366, D416) | Write the annotation the compiler's inference gives, or build with the compiler | 10, 27 |
| EK9101 | The text projector needs a data-method receiver annotation (editor-only suggestion; not emitted by the CLI) | Use “Annotate as the fork infers” to write the checker's receiver type on a local declaration or expression assertion | 10 |

These codes are rules of the language as the table's are. The table lists the codes the compiler's registry holds, which a test keeps equal to it; whether the compiler reports each code below yet is recorded in `typescript/VIBELANG.md` (D374):

- **EK1018**: a call that runs where its destination's declared type, or an element or field type of it, is an Effect or a function with no required parameters returning one, a call whose success type is `never` included, unless its success value is itself a program (Chapter 13, D322, D395). Repair: write the program as a function, `retry(() => fetchUser(id), policy)` (quick fix).
- **EK1019**: a `break` or `continue` that would leave a `do` expression, or a `var` inside one (Chapter 13, D327).
- **EK1020**: `new` on a function declared in a `.vibe` file, which is not a constructor (Chapter 13, D327). Repair: declare a class.
- **EK1021**: a call that no overload candidate accepts with its arguments as they are, where, once each function with no required parameters is converted to a program where a candidate expects an Effect, two function arguments prefer different candidates; a candidate that converts an argument ranks below one that takes it as a function and is no tie (Chapter 13, D380, D482, D500). Candidates TypeScript resolves are never compared: a literal takes the form of the destination the overload TypeScript picks gives it. Repair: an explicit type argument, parameter annotations, `(x: Job) => …`, or a return annotation that writes the literal's form.
- **EK1022**: a syntax error: a block statement whose `{` begins the line after a statement that ends, with no `;`, in an identifier, a member access, or a call, as `return once` followed by `{ … }`, which would return the function and leave the block unreachable (Chapter 13, D376). Repair: join the lines to pass the block as the call's last argument, or end the first line with `;`.
- **EK1023**: a site whose meaning the 2026-10-27 revision changed while it still type-checks: a call the earlier rules passed by name whose success value is itself an Effect, an Effect-typed `const` or field that held such a call, a function value whose form changed, a block after a dual whose appended form type-checks, or a site the migration analyzer cannot classify completely; and an exported factory, which `--fix` will not rewrite. Since D500 it also covers a site an earlier rule gave a function's form by its body that still type-checks: an unannotated function value the earlier rule passed as plain where its destination accepts both forms or picks among overloads, a literal the earlier rule passed as plain where an Effect-callback overload comes first, and an exported function the earlier rule made plain, whose TypeScript API a return annotation would change from a cold `Effect` to a plain function, which `--fix` will not rewrite. The analyzer reports it, and `--fix` rewrites each other site to keep its old meaning; it never guesses (Chapter 13, D382, D500).
- **EK2128**: a continuation `k` used in a clause of a `handle(...)` call other than as the first argument of `resume`, `resumeWith`, or `abandon` in the clause's own body: stored, returned, passed elsewhere, or captured by a nested function or by a form of rule D that runs its body on another fiber or later; a `resume`, `resumeWith`, or `abandon` in a function nested in a handle statement's clause, or in such a form, `fork`, an await operation's element, a block param, or a `for concurrent` body (D455); or a `handle(...)` call whose clauses argument is not an object literal (Chapter 9, D410, D440).
- **EK2129**: a warning by default: an `infer` name other than `_` written in two channels of one contract, which do not connect (Chapter 14, D414, D504). Repair: distinct names, or `infer _`.
- **EK2130**: withdrawn by D500, which removed the channels a contract-less callback parameter carried and their names `E`, `R`, `E2`, and `R2` (D434, D455). A callback writes its channels as type parameters the function declares, `run<A, E, R>(work: () => A!E!R): A!TxError | E!R`, which TypeScript's own scoping checks; the code is reserved and never reported.
- **EK3007**: a service key called with arguments, as `Fn(3)` for `service Fn: (n: number) => number`; `S()` takes none and returns the implementation. It replaces TypeScript's TS2348, whose suggestion of `new` would be EK3003 (Chapter 4, D415). Repair: `Fn()(3)` (quick fix).
- **EK4411**: a hatch whose first argument is a single expression whose type is not a function, followed by inputs, which nothing would receive, or whose type mixes a function with other members, which could be called or returned (Chapter 10, D396, D503). A first argument whose type is a function is the hatch's function: `sync(Math.random)` and `sync(fn, input)` call it. Repair: drop the inputs, or narrow the first argument's type.
- **EK4613**: an element of an await operation's literal operand, or the operand of `fork`, whose type is a program, an Effect or a function with no required parameters, which the element or the new fiber would give back unrun (Chapter 7, D394, D433). Repair: call it, `job()`, `fork job()`.
- **EK4410**: a hatch, or the prelude's `fork` or `join`, used other than as the callee of a call under its own name, such as `const run = sync`, `const spawn = fork`, an import that renames one, or a member of a namespace import of the runtime, `R.fork(x)` (Chapters 10 and 13, D330, D432, D452).
- **EK3208**: the `wire` intrinsic used other than as the callee of a call, such as `const w = wire` (Chapter 4, D363). Repair: call `wire` directly; compose layers chosen at run time with `Layer.provide`.

#### Written forms in existing code

D500 made a function's form written, so code that relied on a body to make a function plain needs a return annotation (Chapter 13, rule F). The compiler reports each site where it is needed and offers the annotation; `vibelang --fix` applies the rewrites that keep the meaning the site had under the earlier rule (D372):

- On each unannotated function that the earlier rule made plain by its body and that code calls or passes where only a plain function fits, at a module's top level, in a `map` callback, under a plain annotation, or at a plain parameter, it writes the return type: `: T` where TypeScript prints `T` in at most 12 tokens, and `: infer _` otherwise. The diagnostic there is EK1001, EK2003, or EK4301, and the same annotation is its quick fix.
- On each callback parameter of a `.vibe` function written without channels, `f: (a: A) => B`, that receives an Effect function or literal, it writes the channels, `f: (a: A) => B!E!R`, and adds `E` and `R` to the function's type parameters, under fresh names where those are taken (rule H1).
- On each literal at a destination that accepts both forms (D112) whose body runs an Effect, which the earlier rule passed as an Effect function, it writes the Effect return annotation, `(x): T!! => …`.
- In each unannotated literal at a destination whose function type returns an Effect, it turns `return cached`, where `cached` is an Effect value the earlier rule returned unlifted, into `return cached()`.

An exported function whose TypeScript API the annotation would change, from a function returning a cold `Effect` to a plain function, is EK1023, and `--fix` does not rewrite it: the person chooses between a plain export and changing the plain uses.

#### Rewrites keep meaning

Every automatic change to source keeps the program's meaning [Rule] (D372). That covers a quick fix, `vibelang --fix`, a refactor applied without a choice, and the formatter.

- **Equivalence.** The rewritten program is observationally equivalent to the original by Chapter 26's model: the same exit and Cause, the same calls to code outside the program in the same order and number, the same bindings, the same lifetimes, and the same suspension points. It has the same types too: every contract, inferred or written, is unchanged. That the rewritten program reports no new error is checked as well, but it is no evidence of equivalence, since a program can type-check and mean something else.
- **Preconditions.** Each fix states the condition under which it is equivalent, and is offered only where the checker proves that condition from the original program's resolved symbols and types. Where a fix would change something, the diagnostic says what would change and offers no automatic fix (D284-D290).
- **Idempotence.** Applying a fix or the formatter a second time changes nothing. `--fix` repeats its rounds until no fix applies, and writes nothing if they do not converge.
- **What the formatter may change.** Whitespace, line breaks, parentheses that do not change the parse, braces around a body of one statement, which never change a fiber's owner (D408), trailing commas, and the order of names inside one import's braces. It never reorders import or export declarations, statements, or members: the order of import declarations is the order in which modules are evaluated (Chapter 26). A file whose formatted text would not parse to the same tree, under those allowances, is left unchanged with an error (D276).
- **Comments** survive every rewrite, next to the code they describe.

A change the rule does not allow is a refactor that a person selects (`refactor.rewrite`, D245), and it says what it changes.

#### Linting

D35 assigns type and language diagnostics to `vibelang` and reserves type-aware
linting for `.ts` files: a stock TypeScript checker models different call
semantics and cannot type-check VibeLang correctly. Check `.vibe` files with
`vibelang --noEmit`.

Syntactic lint runs in ESLint through `vibelang/eslint` (D277). Its parser
runs `vibelang --estree`, which converts the VibeLang parser's tree to ESTree
(`internal/vibelangestree`): TypeScript forms as typescript-estree 8 converts
them, VibeLang forms whose long form would mislead a rule as `Vibe*` nodes,
ranges as UTF-16 offsets into the `.vibe` text, and the source's own tokens and
comments. `packages/compiler/test/eslint/run.sh` holds the conversion to
typescript-estree's output on every `.ts` file in the repository, and lints
every `.vibe` file. `vibelang-oxlint-config` is not shipped, and Vite Plus
integration has no acceptance coverage yet; don't install an unpublished
lint-config package from the registry.

#### Debugging

`vibelang` writes source maps when `sourceMap` is on; the Vite plugin always serves them. Each map carries original `.vibe` positions from the lowered AST through TypeScript emit, so any debugger that reads standard source maps maps breakpoints and paused frames to `.vibe` lines: VS Code's JavaScript debugger (Node.js, Bun, and Chrome targets), Chrome and Edge DevTools, and JetBrains IDEs.

```text
Paused on breakpoint, requestApproval  checkout.vibe:22
Call stack (JavaScript)
  requestApproval            checkout.vibe:22         the running VibeLang function
  runLoop                    effect/dist/internal/effect.js
  evaluate                   effect/dist/internal/effect.js
```

What a debugger shows follows from the frame invariant (Chapter 26):

- **One VibeLang frame at a time.** Compiled functions are generator functions named after their source, so the running function appears by name at its `.vibe` line. A function whose body is a single result returns its Effect without a generator, through a thunk named after it that a stack shows as `PrimitiveImpl.<name>` (D274). Its callers are frames on the fiber's `_stack`, not JavaScript activations, so the call stack shows Effect's run loop below it, not the VibeLang call chain.
- **Regions** are closures named after their function and block: `profile$try`, `profile$catch`, `profile$finally`, `profile$using`.
- **Clauses and producers.** A clause is a generator function named after its operation member (`approve`); a producer's body, one named after the producer (`lines`). A breakpoint in a clause shows the clause; the handled program's frames are inside `k`, a heap value, and reappear when the program resumes. A breakpoint in a producer shows the producer; the loop body runs in the clause of the `for...of` that iterates it.
- **Stepping over a call that pauses** continues on a later run-loop step, so the debugger steps into Effect's run loop; set a breakpoint on the next line instead, as with `Effect.gen` code today.
- **Logical call stacks** across calls and suspensions come from spans: set `tracing` to `"exported"` or `"all"`, and use Effect's `DevTools` layer (`effect/devtools`) with its VS Code extension, which shows fibers and the span stack.
