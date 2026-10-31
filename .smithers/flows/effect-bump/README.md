# The effect-bump flow: move VibeLang to another Effect version

The effect-bump flow moves a VibeLang checkout to another Effect version and
reports what that breaks. It does the mechanical part of a bump; the report is
the input to the fix commits. No step calls a model.

```text
pin ──▶ install ──▶ build ──▶ probe ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| pin | `node scripts/effect-pin.mjs --write <version>`: every manifest that names `effect` or an `@effect/*` package, and the runtime's and compiler's version literals | `pin.json` |
| install | `bun install` (or `npm install`) in each directory whose lockfile pinned the old version, and in `packages/runtime`, `experiments` and `docs/tools`. A `node_modules` link into a shared install is removed first, never written through | `install.json` |
| build | Builds the runtime and the compiler. A build that fails against the new Effect is recorded, not a stop: the runtime's compile errors are part of what to change | `build.json` |
| probe | Runs the checks that compare VibeLang with the installed Effect: the pins, the runtime suite, the kernel law suite, the compiler's root, subpath, collision and platform tables, the mapper's built-in contracts, and the forms table | `probe.json` |
| report | Each failing build and probe with its failing tests or compile errors and the end of its output | `report.json`, `report.md` |

Each step reads and writes the run directory, so a step that already recorded
its result returns it, and a stopped run resumes where it stopped.
`docs/maintainers/effect-upgrade.md` says what each probe's tables are and the
steps after the report.

## Run it

Run it in a checkout you can throw away, such as a `jj workspace add`, because
it rewrites manifests and lockfiles:

```sh
cd .smithers && bun flows/effect-bump/run.ts --run <run dir> --repo <checkout> --version 4.2.0
```

## The eval

`eval.ts` runs the flow, unmocked, on a fresh jj workspace of this repository
and moves it to effect 4.0.6, the version before the current pin. The 4.1.0
bump had to change the root and subpath name tables, so the report must name
`TestEffectRootNamesMatchEffect` and `TestEffectSubpathNamesMatchEffect`
(scorer `found`), and the flow must reach its report, move more than 500 manifests and leave no
pin behind (scorer `pinned`). `baseline.json` holds the recorded scores.

```sh
cd .smithers && bun flows/effect-bump/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/effect-bump/eval.ts --update   # record baseline.json
```

A run installs Effect, builds the runtime and the compiler and runs Go tests.
`EFFECT_BUMP_KEEP=1` keeps the workspace and the run directory. When the pin
moves past 4.1.0, move the eval's version to the version before the new pin
and its expected tests to the tables that bump changed.
