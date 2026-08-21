# Vendored TypeScript fork

VibeLang's compiler base is the `smithersai/TypeScript` fork. A pinned snapshot
of that fork is vendored at `vendor/typescript` with a squashed Git subtree.
This keeps the compiler source in every VibeLang checkout without a submodule
checkout or an implicit network dependency.

The fork repository has not been created yet. `typescript-fork.json` therefore
pins the exact upstream commit from which the fork must start. Once the GitHub
fork exists, that commit will resolve through the fork and can be imported
without changing the manifest.

## Why the fork is required

The TypeScript Go compiler is a nested module under `tsc/`, and its useful
compiler packages are under `tsc/internal`. Go only permits packages within the
parent `tsc` module path to import those packages. VibeLang's parser, checker,
lowering, emitter, and language-service integration must consequently be
implemented behind a narrow extension interface inside the fork.

The intended layout is:

```text
vendor/typescript/             pinned smithersai/TypeScript source
  tsc/                         upstream Go module
    cmd/vibec/                 VibeLang compiler entry point (planned)
    internal/vibelang/         narrow fork-owned extension seam (planned)
compiler/                      stable root transport/API contracts
cmd/vibec-go/                  current not-implemented transport stub
```

The root module must not copy TypeScript internals or use `replace` directives
to bypass that boundary. It will invoke the fork-built compiler through the
process protocol represented by `compiler` until the fork exposes a more
suitable stable boundary.

## Initial import

1. Fork `microsoft/TypeScript` to `smithersai/TypeScript` without rewriting its
   history.
2. Confirm the commit in `typescript-fork.json` resolves in the new fork.
3. Commit all current VibeLang work; subtree operations require a clean tree.
4. Run `npm run typescript:fork:status`.
5. Run `npm run typescript:vendor`.

The last command imports the pinned source and creates a subtree commit. It
refuses to replace a partial `vendor/typescript` directory.

## Updating the fork

Make compiler changes in `smithersai/TypeScript`, keeping the fork's delta
small and reviewable. Merge or rebase the upstream changes there, run the
fork's test suites, and obtain the full 40-character fork commit. Then:

1. Change `revision` in `typescript-fork.json` and commit that lock update.
2. Run `npm run typescript:vendor` from the clean worktree.
3. Run `npm run typescript:fork:verify` and the VibeLang test suites.

Do not patch `vendor/typescript` directly in this repository. Land a patch in
the fork first, then refresh the subtree so fork and vendored history cannot
drift.

## Packaging and licenses

The vendored source remains repository-only; it is not copied wholesale into
the npm tarball. Release packages should eventually contain compiler binaries
built from the pinned revision plus the existing JavaScript compatibility API.
The fork must preserve TypeScript's upstream license and notices inside its
vendored tree.
