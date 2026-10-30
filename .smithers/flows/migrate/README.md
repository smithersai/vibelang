# The migrate flow: an Effect TypeScript codebase to VibeLang

The migrate flow moves an existing Effect TypeScript codebase to idiomatic VibeLang the way a codemod would: in small planned batches, mechanically wherever a rule can do the work, with an agent only where none can, and gated on the target's own tests and public API. Every run also produces the list of what the codemod could not do and what VibeLang got wrong, which is how the next run gets better.

```text
upgrade-effect ──▶ setup ──▶ plan ──▶ for each batch: codemod ──▶ compile ──▶ repair ──▶ verify ──▶ record ──▶ report
(no model)        (no model) (agent)                 (no model)  (no model)  (agent)    (no model) (no model)  (no model)
```

| Step | Model | What it does | Writes |
| --- | --- | --- | --- |
| upgrade-effect | none | Installs and runs the target's tests as they are; moves `effect` and every `@effect/*` package on Effect's major line to the exact version the VibeLang runtime requires, wherever the repository declares it (dependencies, catalogs, overrides), with overrides that keep one copy installed; moves each `name@version` selector and patched dependency that names an old version to the new one (pnpm's `minimumReleaseAgeExclude`, `allowBuilds` and `patchedDependencies`, renaming a patch named for the old version and carrying its `package.json` hunks); installs and runs the tests again; commits the upgrade alone, before any VibeLang change. Separately versioned tools such as `@effect/tsgo` keep their versions, and a peer range keeps its operator | `upgrade-effect.json`, `baseline/upstream-tests.json`, `baseline/upgraded-tests.json` |
| setup | none | On the upgrade's commit, sets VibeLang up (dependencies, `tsc` to `vibelang` in scripts, the `vibelang-vite` plugin, `rewriteRelativeImportExtensions`, the `vibelang` setting `declarationSidecars` and a `.vibe` include pattern beside each `.ts` one (`src/**/*.vibe` beside `src/**/*.ts`) in each package's tsconfigs, `allowArbitraryExtensions` in every tsconfig that extends none of the repository's others, `*.d.vibe.ts` in `.prettierignore`, and, under pnpm, `dprint` in `allowBuilds` in `pnpm-workspace.yaml`; for a test command that runs `bun test`, `preload = ["vibelang/bun"]` under `[test]` in its directory's `bunfig.toml`; Knip's compiler for `.vibe`, `vibelang/knip`, in a `knip.config.ts` that keeps a JSON configuration's settings); installs and runs the tests as the baseline, compared with the upgraded tests; checks each package with `vibelang`; emits its declarations; inventories every source file; runs `vibelang agents init`, so the target's coding agents get the VibeLang skill, the language server and a check after each edit; commits | `setup.json`, `baseline/`, `inventory.json` |
| plan | one agent call | Orders the Effect files into small batches, leaves and tested modules first, each with a reason; the answer is validated before anything reads it | `plan.prompt.md`, `plan.draft.json`, `plan.json` |
| codemod | none | Marks each member TypeScript declares writable `mutable`, which keeps it writable in `.vibe` (D134), renames the batch to `.vibe`, rewrites imports by VibeLang's rules, runs `vibelang --fix` until it fixes nothing, keeping the rewrites of the batch's files only (an earlier batch's committed files stay as committed), and records each rewrite it applied or refused | `batches/NN/codemod.json` |
| compile | none | `vibelang --noEmit`: the batch's diagnostics and any error new against the baseline | `batches/NN/compile.json` |
| repair | agent | Fixes what is left and finishes the idiomatic rewrite, with `context.md` as its system prompt; records codemod gaps, VibeLang issues and idiom lessons; returns a file it cannot migrate to `.ts` | `batches/NN/repair.prompt.md`, `repair.json`, `issues.jsonl` |
| verify | none | The tests pass with no new failure against the baseline; the emitted declarations are identical to the baseline's; the batch has no error, no EK48xx and no EK4402 | `batches/NN/verify.json` |
| record | none | Commits the batch with jj, naming its files, with o200k token counts before and after | `batches/NN/record.json` |
| report | none | Batches, tests, declaration identity, tokens, codemod gaps, issues and idiom lessons | `report.md`, `report.json` |

Each step reads and writes the run directory, so a step that already recorded its result returns it, and a stopped run resumes where it stopped.

Upgrade-effect, setup and record run the target's own formatter on the files they wrote or the batch changed, other than `.vibe` files, sidecars and lockfiles: the tool its root `package.json`'s format scripts run (`oxfmt`, `vp fmt`, `prettier`, `biome format`, `dprint fmt`), else one it installs. The target's format check then passes on them. Record then runs the target's `vibelang-format --write` on the batch's `.vibe` files, because `vibelang --fix` does not format what it rewrites and a format check covers them.

## Run it

Every batch lands on a jj bookmark, `vibe` unless `--bookmark` names another: upgrade-effect starts it on the default branch (`trunk()`, or `--base <branch>`, such as `dev`, which restarts a bookmark an earlier run left elsewhere), or continues an earlier run's `vibe`, and each recorded batch is one commit on top of the last. The first two commits are the Effect upgrade and VibeLang's setup, so a reviewer reads the dependency upgrade, and any test it breaks, apart from the migration. The flow never pushes. After each run, the orchestrator pushes `vibe` to the library's fork and opens a pull request from it there, so the migration's diff is reviewable.

Both ways need a VibeLang toolchain: a published version (`--vibelang-version 0.0.11`), or a staged build of a checkout, which runs the compiler on main before it is published:

```sh
sh scripts/build-vibelang.sh && (cd packages/runtime && bun install && bun run build) && (cd docs/tools && bun install)
node .smithers/flows/migrate/step.mjs toolchain --vibelang . --out <toolchain>
```

The toolchain holds the native compiler, npm tarballs of `vibelang` (with that compiler), `vibelang-runtime` and `vibelang-vite`, and the TypeScript compiler API that reads declarations. Setup copies the tarballs into `.vibelang-toolchain/` at the target's root, each named for its content (`vibelang-0.0.11-<hash>.tgz`), adds that directory to the target's `.gitignore`, and names them relatively from each package (`file:../../.vibelang-toolchain/vibelang-0.0.11-<hash>.tgz`), so no commit names a path on the build host. Every build of one version packs to the same file name, and npm, Bun and pnpm can keep parts of what an unchanged `file:` specifier installed before, its files or its command links; the content's name makes a rebuilt toolchain install. Every commit the flow makes first checks the lines it adds for this machine's absolute paths and refuses them. The target must be a jj repository or a Git checkout, which upgrade-effect makes a colocated jj repository.

### Registry versions

Once VibeLang publishes the version a migration needs, use the registry instead of a staged toolchain: start the run with `--vibelang-version <version>` in place of `--toolchain <dir>`. Setup then writes exact versions (`"vibelang": "0.0.12"`) and makes no `.vibelang-toolchain/`. Anyone can install the result, and the fork's pull request no longer depends on the tarballs.

To switch a target that a staged toolchain set up, start a new run on it with `--vibelang-version`. Upgrade-effect continues on the `vibe` bookmark, and commits only when the version needs another Effect. Setup then replaces the three `file:` specifiers with the version, deletes `.vibelang-toolchain/` and its `.gitignore` line, reinstalls, records a new baseline, and commits the switch on top. The batches already on `vibe` stay as they are.

### Step by step

Each command prints its result and the next step. A person, or an agent session driving the run, answers the two agent steps:

```sh
step="node .smithers/flows/migrate/step.mjs"
$step upgrade-effect --run <run> --target <repo> --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
$step setup --run <run>                       # reads the run's options
$step plan --run <run>                        # writes plan.prompt.md and a deterministic draft
$step plan --run <run> --accept <answer.json> # validates and records the plan
$step codemod --run <run>
$step compile --run <run>
$step repair --run <run>                      # writes batches/NN/repair.prompt.md; do the repair it asks for,
                                              # checking with compile --no-record and verify as you go
$step repair --run <run> --done               # checks issues.jsonl and records the repair
$step verify --run <run>                      # a failure sends the batch back to repair
$step record --run <run>
$step report --run <run>
$step next --run <run>                        # what to run next
```

`--agent "<command>"` on `plan` or `repair` runs an agent instead: the command gets the prompt on stdin and its path in `MIGRATE_PROMPT`, runs in the target's root, and for `plan` writes its JSON answer to `MIGRATE_OUTPUT`. Any coding agent with a non-interactive mode fits; the flow has no code for any particular one. `revert --file <path.vibe> --reason "<text>"` returns one file of the current batch to its `.ts` source, and points every import the codemod rewrote to `.vibe` back at the `.ts` file.

Every TypeScript checker of the repository reads the migrated modules: each `vibelang` compile of a migrated package writes `x.d.vibe.ts` beside `x.vibe` (the `vibelang` setting `declarationSidecars`), and the batch commits it with the module. Stock `tsc`, `tsrs`, `bun check` and TypeDoc resolve `./x.vibe` to it under `allowArbitraryExtensions`, so the codemod writes that name in every `.ts` importer, for `./x.js` and `./x.ts` alike; `vibelang` emits and declares it as `./x.js`. An extensionless `./x` stays as written, since its declaration would change, and those checkers cannot resolve it. They read only the sidecars, so a `.vibe` file's type errors are reported by `vibelang`, which every migrated package's scripts run. `revert` puts back each importer's original specifier and deletes the sidecar.

Setup adds the `vibelang-vite` plugin to the Vite or Vitest config the tests load. When the test command, or the package script it runs (`pnpm test`), names one with `--config`, such as a monorepo's shared `../../vite.config.ts`, setup wires that file, and the package that owns it gets `vibelang` and `vibelang-vite` as dev dependencies. Otherwise it wires each package's own config. It then adds the plugin to every other Vite or Vitest config that bundles migrated sources: each config in a migrated package, or in a package that depends on one through workspace packages (`"foldkit": "workspace:*"`), such as an app's, an example's or a website's, so their builds and dev servers load `.vibe` modules too. Configs under `fixtures/` and `templates/` are left alone, and a config whose shape the edit does not know, such as `defineConfig(() => ({ ... }))`, is named in setup's warnings for a person to wire.

`upgrade-effect` takes the run's options, which setup and the later steps read from the run: `--base` and `--bookmark` (above), `--package` and `--source` more than once, `--tsconfig` (default `tsconfig.json`, the project the tests check), `--dts-tsconfig` (default `tsconfig.build.json` when it exists: the project whose declarations are the public API), `--install`, `--no-wire` for a target that already has VibeLang, `--max-files` and `--max-lines` per batch (6 and 900), and `--allow-dirty`.

### As a Smithers flow

`flow.ts` declares the same steps as durable actions of `Flow.make("migrate", ...)`. One execution upgrades Effect, sets the run up and plans it the first time, then migrates the next batch and reports; the next execution migrates the batch after it. `run.ts` runs one execution on the in-memory engine:

```sh
MIGRATE_AGENT="<agent command>" bun .smithers/flows/migrate/run.ts --run <run> --target <repo> \
  --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
```

The agent steps read `MIGRATE_AGENT` through Effect `Config`; without it, they fail with the prompt to answer, and the standalone steps take over from there. The agent is a command, not `@smthrs/agent`: a repair edits files and runs the target's compiler and tests in its repository on a build host, which a coding agent's non-interactive mode does today, and this repository's `.smithers` composes no model seat for `AgentAction`. A test supplies a scripted command.

## The idiom context

`context.md` is the repair agent's system prompt. `build-context.mjs` generates it, so it is never edited by hand:

- `rules.md`, this flow's own rules: the current call rule (a call runs where it stands; only a function literal defers it), every VibeLang form, wrapping Effect mindfully, platform access only through services, Effect's modules or `Experimental.*`, hatches only for real Promise and callback libraries, identical declarations, every test kept.
- The VibeLang skill, `packages/compiler/skills/vibelang/SKILL.md`.
- The convert flow's cheat sheet and worked examples (`../convert/`).
- The platform globals table, `docs/user/src/platform/platform-globals.md`.

```sh
node .smithers/flows/migrate/build-context.mjs           # write context.md
node .smithers/flows/migrate/build-context.mjs --check   # fail when it is stale
```

## Each run improves the next

A run's `issues.jsonl` is the input to the loop that improves the flow. The repair agent appends one entry per lesson; upgrade-effect and setup append one when the Effect upgrade or setting VibeLang up breaks a target test before any file moves, and still finish, so no batch is blamed for it. A runner without per-test results, such as `bun test`, is compared by its exit status, and the issue names the logs from before and after.

| Entry | Where it goes |
| --- | --- |
| `codemod-gap`: a rewrite made by hand that a rule could make (`pattern`, `before`, `after`, `count`) | A `--fix` rule in the compiler: a quick fix for the diagnostic (`typescript/tsc/internal/vibelang/tsforms_*.go` or `lsrules_fixes.go`), its code in `tsFormFixCodes` when it is safe, and a case in `typescript/vibelang/cases/` with the before and after. The next run's codemod applies it. |
| `idiom`: a lesson the context did not teach (`lesson`, `before`, `after`) | One line in `rules.md` (or the skill, when it is about the language rather than migrating), then `node build-context.mjs`. |
| `issue`: a VibeLang bug or missing feature (`title`, `repro`, `expected`, `actual`, `files`) | A VibeLang issue with the reproduction, fixed with a test. The blocked files stay `.ts` until it is fixed; the next run's plan picks them up. |

`report.md` lists all three, with the rewrites `--fix` applied and refused, so a run's report says which rule to write next.

### What `--fix` rewrites

| Effect TypeScript | `--fix` writes | Code |
| --- | --- | --- |
| `Effect.gen(function* () { … })`, or with `{ self: this }`, as the whole body of an arrow, a function or a method, or where the declared type takes a program, such as `Layer.effect`'s | The body in direct style: `yield* e` becomes the call `e`, `e()` for an Effect value such as a service key, or `throw e` for an error instance; `() => { … }` where a program is expected | EK1002 (D470) |
| `Match.value(x).pipe(Match.when(…), …, Match.exhaustive)`, `pipe(Match.value(x), …)`, `Match.type<T>().pipe(…)` | `match (x) { when …: …; default: …; }` | EK4839 (D472) |
| `pipe(x, Option.map(f), Option.getOrElse(g))`, `x.pipe(Option.…)` | `x.map(f).getOrElse(g)`, or `Option.fromNullishOr(x).map(f)` for a value that is not an Option | EK4840 (D473) |
| `type X = typeof X.Type` just before `const X = Schema.Literals([…])`, or another schema other than a struct whose every part has a type | `schema X = <type>` | EK4841 (D474) |
| `import { Array } from "effect"`, or another of Effect's modules a JavaScript global names (`String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt`, `RegExp`) | `import { Array as Arr } from "effect"`, and `Arr.take(…)` for each use | EK4842 (D475) |
| Effect error classes, `Context.Service` classes, `Schema.Struct` constants, `Effect.Effect<A, E, R>`, a running `Effect.succeed` or `Effect.fail`, catch combinators, `Effect.withSpan`, `provide` and `provideService` | `error`, `service`, `schema`, `A!E!R`, the value or `throw`, `catch` and `match`, the block forms | EK4830-EK4836 |

Each rewrite keeps the program's meaning and type, or it is not made: the diagnostic it leaves says why in a note that starts `No quick fix:`.

### Known codemod gaps

These patterns have no `--fix` rule yet. The counts are from the four first targets (foldkit, t3code, alchemy and opencode: 44,235 `Effect.gen` sites). A repair records a `codemod-gap` only for a pattern not listed here.

| Pattern | Count | Why there is no rule |
| --- | --- | --- |
| `Effect.gen(…).pipe(stage, …)` | 11,397 `Effect.gen` sites (26%) | Each stage has its own form, `provide L { … }`, `withSpan(() => { … }, "name")`, `x catch (e) => …`, `retry(() => …, policy)`; a generic rewrite would nest `() =>` per stage |
| `Effect.fn("name")(function* (…) { … })` and `Effect.fnUntraced(…)` | 120 of 338 EK1002 sites in the sampled files | `Effect.fn` records a span and the call site's stack frame, which `withSpan(() => { … }, "name")` does not |
| `const p = Effect.gen(…)`, `return Effect.gen(…)` after other statements, `yield* Effect.gen(…)` | 2,135 `Effect.gen` sites (5%) | A program value: what replaces it depends on every use |
| A parameter with a default or a pattern, `({ id }) => Effect.gen(…)` | 1,361 (3%) | TypeScript binds it when the function is called, VibeLang when its program runs |
| A call that builds a program no `yield*` runs, as `yield* load(id).pipe(Effect.retry(policy))` or `Effect.all([a(), b()])` | most of the rest | The call would run where it stands; the call-rule migration (EK1018, EK1023) writes `() =>` |
| `Match.when` with a predicate or an array pattern, `Match.discriminator`, a handler that builds a program | | No pattern tests the same, or the arm's call would run |
| An Option stage whose argument is a call, `Option.getOrElse(makeDefault())` | | The chain would evaluate it after the stage before it runs |
| A redundant `readonly` on an interface or object-type member, `{ readonly id: string }` | 26 (foldkit 22, alchemy 4) | No diagnostic reports it yet, and inside `Readonly<{ … }>` the TypeScript's `readonly` must stay for declaration identity |
| `Option.match(x, { onNone, onSome })` | 3 (foldkit) | EK4840 rewrites Option pipelines only; a `match` over `Option.None` and `Option.Some(let v)` is the target |
| A pure exported or callback helper that TypeScript consumers call synchronously, `(xs) => xs.filter(p)` | 20 (foldkit 13, t3code 5, opencode 2) | Before D550 lands, context can make it an Effect function; `: infer _` keeps it plain. Under D550 a function with no Effect form is plain by syntax, and the annotation is moot |
| `x.pipe(Stream.map(f))` on a Stream value | 1 (foldkit) | EK4840's method rewrite covers Option only |
| A cold `Effect.map` or `orElseSucceed` program, `Effect.currentParentSpan.pipe(Effect.map(f), Effect.orElseSucceed(() => undefined))` | 2 (alchemy) | The deferred direct-style body depends on each use of the value |
| A schema constant written before its type alias, `const X = Schema.…` then `type X = typeof X.Type` | 818 of 820 such pairs that are not structs; 1,474 struct pairs | A schema declaration's declaration file lists the type before the constant, so the rewrite would reorder the module's declarations: EK4841 leaves these pairs, and EK4832's rewrite of a struct pair changes the declarations |

## Tests

```sh
node --test .smithers/flows/migrate/test/*.test.mjs
```

The deterministic steps are tested against fixtures: import parsing and rewriting, `--fix` output, diagnostics, the plan's draft and validation, the setup edits, test-report comparison, declaration canonicalization (it needs `bun install` in `packages/runtime`, whose TypeScript has the compiler API), the run's state machine, issue validation and the generated context.
