# Moving the TypeScript fork to a newer upstream

`typescript/` is upstream microsoft/TypeScript at one commit, without
`tsc/testdata`, plus VibeLang's changes: new packages under `tsc/internal/`
and small seams in upstream files. `typescript/VIBELANG.md` records the commit
(its "Upstream commit" row) and lists every seam ("Seams in upstream files").
The pin is the `gitHead` of an npm `typescript@next` nightly, so the stock
compiler a user installs and the fork start from the same source.

The fork's commits are interleaved with the rest of the repository's history,
so a bump cannot rebase them. It merges instead: the pinned upstream tree is
the base, `typescript/` is one side and the newer upstream tree the other.

## Steps

The ts-bump flow runs steps 1 to 4 in a throwaway checkout and writes a report
of what to change: `.smithers/flows/ts-bump/README.md`.

```sh
jj workspace add ../ts-bump --name ts-bump -r main
cd .smithers && bun flows/ts-bump/run.ts --run ../../ts-bump-run --repo ../../ts-bump --to next
```

1. Merge upstream's changes since the pin into `typescript/` and move the pin.
2. Regenerate what upstream's structs generate:
   `sh tsc/internal/effecttsgo/sync.sh <tag in effecttsgo/UPSTREAM>` from
   `typescript/` regenerates `tsc/internal/diagnostics` and the Effect rules'
   shims. Upstream's own generated files (`*_generated.go`) merge as text; if
   upstream changed their generator, rerun it with `npx hereby generate:<name>`
   and keep the `vibelang` option lines `tsoptions/vibelang.go` lists.
3. Build: `go vet ./...` in `typescript/tsc` and `sh scripts/build-vibelang.sh`.
4. Run the targets that cover the fork: `//typescript:compiler`,
   `//:spec-tests`, `//:go-vibelang`, `//:go-vibelangmapper` and
   `//typescript/vibelang/...`.
5. Resolve each conflict in the report's "Conflicts" table. The seam column
   says what the fork's lines do; keep that behaviour on upstream's new code,
   then update the seam's row in `VIBELANG.md` if its lines moved.
6. Read each file under "Merged without conflict": a clean text merge can
   still call a function upstream renamed or changed. The compile errors and
   failing tests in "Checks" point at the rest.
7. Record what a VibeLang user sees (a new TypeScript diagnostic, a changed
   type) in `docs/user/src/setup/release-notes.md`, and land the bump as one
   commit with its fixes, or as the merge followed by fix commits that each
   pass.

## What one week costs

Measured 2026-10-31 against the pin `257e874` (2026-10-14):

| Target | Upstream files changed | Merged by text | Conflicts | Build after the merge |
| --- | --- | --- | --- | --- |
| `98add1b`, one week | 292 | 18 | 0 | fails: `effecttsgo/lint/command.go` passes a `vfs.FS` where `tsoptions.GetParsedCommandLineOfConfigFilePath` now takes a `ParseConfigHost` |
| `6161772`, two weeks | 498 | 41 | 3 (`emitter.go`, `ls/utilities.go`, `CONTRIBUTING.md`) | fails on the conflict markers |

Bumping weekly keeps each merge small; the 7.1 stable release is planned for
2026-11-24 (`docs/research/typescript-native-compiler.md`).
