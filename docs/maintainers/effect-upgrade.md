# Moving the Effect pin

VibeLang supports exactly one Effect version: the `effect` entry of
`packages/runtime/package.json`'s `peerDependencies`. Every other manifest that
names `effect` or an `@effect/*` package pins the same version, and so do the
literals that state it in code:

| File | Literal |
| --- | --- |
| `packages/runtime/src/version.ts` | `PINNED_EFFECT_VERSION` |
| `packages/runtime/src/version-guard.cts` | `PINNED_EFFECT_VERSION` |
| `typescript/tsc/internal/vibelang/effectavailable.go` | `supportedEffectVersion` |

`scripts/effect-pin.mjs` checks this, and its test runs in the `//:release`
target of the merge gate:

```sh
node scripts/effect-pin.mjs              # list every pin that differs; exit 1 if any does
node scripts/effect-pin.mjs --write      # move every differing pin to the runtime's
node scripts/effect-pin.mjs --write 4.2.0 # move the runtime's pin, then every other
```

`--write` edits only the version strings, so each manifest keeps its
formatting. A new compiler case copied from an older one fails the check until
`--write` moves its pin.

Two manifests are exempt because a tool, not VibeLang, decides their Effect:
`.smithers/package.json` (the Smithers packages) and `site/package.json` (the
site's Cloudflare deploy).

## Steps

The effect-bump flow runs steps 1 to 4 and the checks that compare
VibeLang with Effect, in a throwaway checkout, and writes a report of what to
change: `.smithers/flows/effect-bump/README.md`. Beside the manifests it moves
the old version wherever a file states it as the current one (docs, tests,
cases, stubs), and regenerates the subpath table, the forms table and the
generated docs: on the 4.1.1 bump that was 824 of the 861 files a person had
edited by hand. Start there, then move the pin guards' witnesses the report
lists and fix what its checks name.

1. Run `node scripts/effect-pin.mjs --write <version>`. It prints each
   directory whose lockfile still pins the old version; run `bun install` (or
   `npm install` for a `package-lock.json`) there.
2. Rebuild the runtime and the compiler: `(cd packages/runtime && bun run build)`
   and `sh scripts/build-vibelang.sh`.
3. Run the tests that compare the compiler's tables with the installed Effect,
   from `typescript/tsc` with `EFFECT_NODE_MODULES` set to the new install:
   `TestEffectRootNamesMatchEffect`, `TestEffectSubpathNamesMatchEffect` and
   `TestEffectNameCollisionsDocumented` (`internal/vibelang`),
   `TestPlatformServicesTable` and `TestModuleServicesDocumented`, and
   `TestBuiltinContractsGenerated` (`internal/vibelangmapper`). Each failure
   names the table row to add or remove.
4. Regenerate the forms table with `scripts/check-forms-table.sh --write` and
   explain every moved decision in `forms_decisions_approved.txt`.
5. Read Effect's release notes for each version in between and record every
   change a VibeLang user sees in `docs/user/src/setup/release-notes.md`.
6. Run the full validation: the runtime suite, the compiler cases, the Go
   suites and the examples.
