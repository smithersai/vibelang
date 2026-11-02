# The effect-bump flow: move VibeLang to another Effect version

The effect-bump flow moves a VibeLang checkout to another Effect version and
reports what that breaks. It does the mechanical part of a bump; the report is
the input to the fix commits. No step calls a model.

```text
pin ──▶ literals ──▶ install ──▶ build ──▶ regenerate ──▶ probe ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| pin | `node scripts/effect-pin.mjs --write <version>`: every manifest that names `effect` or an `@effect/*` package, and the runtime's and compiler's version literals | `pin.json` |
| literals | Moves the old version wherever a tracked text file states it as the current one: install docs, spec chapters, tests, compiler cases' `run.mjs`, and the stubs of `@effect/*` packages under `stubs/`. `lib/literals.mjs` names the files that keep it and why: manifests and lockfiles (other steps move them), the pin guards, whose witnesses are the versions around the pin, and fixtures | `literals.json` |
| install | `bun install` (or `npm install`) in each directory whose lockfile pinned the old version, and in `packages/runtime`, `experiments` and `docs/tools`. A `node_modules` link into a shared install is removed first, never written through | `install.json` |
| build | Builds the runtime and the compiler. A build that fails against the new Effect is recorded, not a stop: the runtime's compile errors are part of what to change | `build.json` |
| regenerate | Rewrites the generated files that read Effect or the pin: the compiler's subpath module table (`scripts/generate-effect-subpaths.mjs`), the D252 data methods, the forms table, what `docs:generate` writes (the throws inventory among them) and the token counts. A failure is a finding, as in build: the forms table refuses a moved decision until `forms_decisions_approved.txt` explains it | `regenerate.json` |
| probe | Runs the checks that compare VibeLang with the installed Effect: the pins, the runtime suite, the kernel law suite, the compiler's root, subpath, collision and platform tables, the mapper's built-in contracts, and the forms table | `probe.json` |
| report | Each failing build, generator and probe with its failing tests or compile errors and the end of its output, then the files that keep the old version for a person to move | `report.json`, `report.md` |

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

`eval.ts` replays a real bump. It runs the flow, unmocked, on a fresh jj
workspace of main `61878b40` (effect 4.1.0), moves it to 4.1.1, and compares the
result with the commit lane effect411-vibelang wrote by hand on that main
(`fixture/effect-4.1.1.json`). That bump changed 861 files. The flow must write
820 of them byte for byte: the manifests, literals and stubs, and the
inventories it regenerates. Lockfiles are left out, since their bytes depend on
the registry on the day. On 2026-11-02 the flow changed 836 files, every one a
file the lane changed, and 824 matched the lane's bytes. Of the other 37, the
subpath table holds the same six `effect/jose` rows sorted by name; the rest are
the person's part: the pin guards' witnesses, new tests, prose, and the
lockfiles and generated files that follow them.

| Scorer | 1 when |
| --- | --- |
| `found` | The report names what the lane then fixed by hand: `TestModuleServicesDocumented` (4.1.1's `Jwks` is a module service the spec must document) and the runtime's pin guard |
| `pinned` | The flow reaches its report, moves more than 500 manifests and leaves no pin behind |
| `reproduced` | Every one of the lane's version-only files matches byte for byte (the score is the share) |
| `only-lanes` | Every file the flow changed is one the lane changed too (the score is the share) |

```sh
cd .smithers && bun flows/effect-bump/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/effect-bump/eval.ts --update   # record baseline.json
```

A run installs Effect, builds the runtime and the compiler and runs Go tests.
`EFFECT_BUMP_KEEP=1` keeps the workspace and the run directory. The fixture
is history, so it stays valid after the pin moves on; replace it only with
another hand-made bump, built the same way (its base, version, changed files and
the digests of its version-only files).
