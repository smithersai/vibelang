The default full parity run also measures documentation diagnostics. Use
`sh packages/ts-mapper/test/parity/run.sh --docs` to run only that lane.
It took 16 seconds on the implementation check, below the 60 second budget.
Case selectors continue to select only declaration cases.

The lane imports `extract`, `markdownPages`, and `writeProject` directly from
`docs/tools/check-snippets.ts`. It includes fragments, expected errors, compiler
gaps, and TypeScript companion blocks under docs/user (excluding generated site),
and every VibeLang source under examples and templates. Each page or example is a
project. Companion sources participate in checking; the module denominator and
reported diagnostic sites are VibeLang sources. Project options are strict NodeNext,
no emit, skipLibCheck, and no ambient types; example build configs are not used.
Relative JavaScript/extensionless imports targeting VibeLang are adapted on both
compiler sides. The stock compiler and mapper/runtime/effect package scope are
exactly those built by run.sh; no source-workspace node_modules are inherited.

Mapper diagnostics come from the production mapper's `--print` entry; stock
TypeScript checks through its content mapper and maps positions to original
sources. The fork checks the same materialized sources. A matching fork diagnostic
at the same source file, line, and code is excluded. A stock diagnostic mentioning
D251 is grouped under D251 while retaining its TS code in the CSV. Exact duplicate
sites from the mapper and stock are counted once. Markdown line numbers use the
snippet writer's prefix offsets. Mapper byte offsets are decoded as UTF-8.

A project with missing module, type library, config, source, side-effect import,
or JSX runtime diagnostics on either side is excluded entirely. Missing optional
packages are visible here rather than silently supplied by workspace dependencies.
`out/docs-unresolved.md` lists those projects; summary.json also records reasons.
`out/docs-diagnostics.csv` contains the measured diagnostic headlines, and each
materialized project under out/work/docs retains both compiler logs. Summary
fields have no absolute paths or timing inputs. Repeated runs replace these
artifacts. A docs-only run updates the docs fields and line in the existing
summary; the normal full run regenerates the declaration results and adds docs.

`--self-test` materializes a scratch Markdown page using the same pipeline and
requires exactly one newly surfaced EK9100; it also runs the existing parity
mutation tests. This fixture is never included in the corpus denominator.

A declaration measurement requires at least one selected case. With no matching
case, the full CLI exits `2` and lists the selectors before setting up modules
or replacing `manifest.json`, `summary.json` or `summary.md`. Exact names,
substrings and unions retain their selection rules. `--docs` and `--self-test`
run independently of declaration selectors.
