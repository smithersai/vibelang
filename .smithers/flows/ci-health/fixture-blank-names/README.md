# Whitespace-only failure names

Four actual Node executions alternate controlled failure and success through
both compiler and migration reporters. Node normalizes the empty written name
to `<anonymous>` and retains the other seven whitespace-only names.

The flow must retain every reported name, its failure counts and returning-test
observations. Both rendered test tables preserve the names using the existing
preformatted cells and line-break rendering.

Regenerate with `node .smithers/flows/ci-health/fixture-blank-names/record.mjs`.
