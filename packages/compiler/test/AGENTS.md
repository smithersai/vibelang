# Compiler tests

Tests here own compiler behavior. Migration and convert suites live in
`.smithers/flows/migrate/test/` and `.smithers/flows/convert/` and run in
`//packages:migrate-test`.

Do not import or re-export those suites from this directory. A forwarding
file repeats the suite in the compiler target. Add migration scenarios to
their canonical suite instead.

`scripts/test-runners.test.mjs` checks this boundary and compares its import
audit with Node's module loader.
