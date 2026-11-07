# Whitespace in actual reporter names

Run `node .smithers/flows/ci-health/fixture-whitespace/record.mjs` to regenerate
these four graph histories. Each runs the actual compiler and migration Node
reporters over the same source, alternating controlled failure and success.
Each target retains its own source-and-reporter key.

Six distinct names cover edge spaces, repeated spaces, tabs and indentation
after a line break. The reports must retain two failures per name and display
their spacing in both test tables. Fixture paths are scrubbed.
