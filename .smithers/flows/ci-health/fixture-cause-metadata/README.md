# Structured cause attribution fixture

Four actual Node runs alternate assertion failure and success, using both the
compiler and migration reporters. Test names contain resource and timeout terms;
their assertion errors do not. Empty-reason `todo` and `skip` controls also emit
expected failures. Only the ordinary assertion supplies failure-cause evidence.

Regenerate from the repository root with
`node .smithers/flows/ci-health/fixture-cause-metadata/record.mjs`.

The recorder scrubs fixture paths and hashes the test and reporter sources.
