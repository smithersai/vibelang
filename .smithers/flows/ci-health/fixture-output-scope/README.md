# File-level test output

Eight actual Node executions use the compiler and migration reporters, alternating
failure and success with an unchanged key per target. The first pair prints
resource messages from an empty-reason `todo`; the second prints identical
stdout, stderr and diagnostic text from the ordinary test. Node supplies only file identity for
stdout and stderr; the compact diagnostic record also has no test identity. Both failed runs have an actual assertion failure.

The expected cause is `assertion`; `disk full`, `killed`, `timeout` and
`connection` remain unattributed candidates with two failed runs each. Neither
the todo name nor its error becomes an actual failed test.

Regenerate with `node .smithers/flows/ci-health/fixture-output-scope/record.mjs`.
