# Repository migration flow

The VibeLang source checkout includes a contributor tool for converting an
Effect TypeScript repository in batches. For a manual setup with published
packages, see [Add VibeLang to an existing project](src/setup/existing-project.md).

## Run from a checkout

Follow [contributor setup](../../CONTRIBUTING.md) and use Jujutsu in a clean
target checkout. Choose a run directory outside the target. The run writes
commits to a bookmark, so choose a dedicated one. From the VibeLang checkout,
start with a published toolchain:

```sh
node .smithers/flows/migrate/step.mjs upgrade-effect \
  --run /path/to/run --target /path/to/target --bookmark migration/example \
  --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core \
  --vibelang-version 0.0.13
node .smithers/flows/migrate/step.mjs setup --run /path/to/run
node .smithers/flows/migrate/step.mjs next --run /path/to/run
```

Replace the package, test command, and test directory with the target's own
values. See the [full command sequence](../../.smithers/flows/migrate/README.md#step-by-step)
for planning, conversion, review and recording. The same guide covers
[staged toolchains](../../.smithers/flows/migrate/README.md#run-it) and
[whole-scope runs](../../.smithers/flows/migrate/README.md#whole-scope-conversion).

## What the flow handles

- Setup discovers workspace consumers by imports and dependency declarations.
  It wires compiler projects, test and subprocess preloads, Vite and other
  bundlers, and formatter and lint configuration. Test and fixture source
  stays available for comparison against the baseline. Review the located
  warnings for tool configurations that need a manual edit.
- Planning and conversion track source paths, including JSX extensions,
  aliases, build inputs and exports. The [path checks](../../.smithers/flows/migrate/README.md#paths-to-converted-files)
  report computed paths and bundle entries that need review. The
  [publication routes](../../.smithers/flows/migrate/README.md#publication-routes)
  describe emitted JavaScript and declarations for native consumers.
- The repair step handles diagnostics and preserves existing evaluation
  order, the distinction between constructing and running an Effect, and
  platform boundaries. The [migration rules](../../.smithers/flows/migrate/rules.md)
  describe cases that need a TypeScript boundary or an explicit rewrite.
- Verification compares test results, public declarations, build output and
  package contents against the original project. Keep the per-package setup
  and validation reports in the run directory. Review the report before
  recording each batch. See [stale conversions](../../.smithers/flows/migrate/README.md#stale-conversions)
  for resuming or returning a module to TypeScript.
