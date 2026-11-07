import { test } from "node:test"
import assert from "node:assert/strict"

// Names describe error handling; the controlled failure is an ordinary assertion.
for (const name of [
  "handles ENOSPC diagnostics", "handles SIGKILL diagnostics",
  "handles TimedOut: ChildProcess.spawn diagnostics", "handles timed out after diagnostics",
  "handles ECONNRESET diagnostics", "Cannot find package 'example' imported from metadata",
  "property example failed; saved metadata"
]) test(name, () => assert.equal(process.env.CI_HEALTH_WITNESS_STATE, "pass"))

test("expected resource control", { todo: "" }, () => { throw Error("ENOSPC SIGKILL ECONNRESET") })
test("expected deadline control", { skip: "" }, () => { throw Error("test timed out after 5ms") })
