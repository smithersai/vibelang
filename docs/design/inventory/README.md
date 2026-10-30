# Thrown-signature inventory

Run `node docs/tools/throws-inventory.mjs --write` from the repository root
after regenerating the compiler's global table. Run the same command with
`--check` to check freshness. The docs-tools tests run that freshness check
when validating the repository.

[`throws.json`](throws.json) is the first slice of decided detail 81a:
an overload-indexed snapshot of the global own-throw contracts the compiler
currently ships. Each record includes its bundled declaration inputs.
The snapshot hashes every bundled TypeScript lib file and the compiler's
generated table, records the parser version, and records the runtime's
Effect pin. A change to any input requires regeneration.

The `coverage` fields describe what is available. Effect export annotations,
`@rethrows`, callback admission and returned-callable contracts are not yet
included. The snapshot does not certify that the current annotations fully
implement decided detail 81. In particular, entries absent from the compiler's
table are `unknown`, including constructor signatures the current table
does not classify. These gaps remain compiler work; the generator does not
turn missing annotations into `never`.

The compiler and snapshot use the same generated
`typescript/tsc/internal/vibelang/globalthrows_table.go` values. Its existing
`TestGlobalThrowsTable` checks those values against their curated source and
bundled libs. The snapshot's freshness test additionally checks every
overload and input hash.
