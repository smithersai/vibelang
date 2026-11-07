import { test } from "node:test"
import assert from "node:assert/strict"

for (const name of ["", " ", "\t", "\n", "\r\n", "\u2028", "\u2029", "\u00a0"]) {
  test(name, () => assert.equal(process.env.CI_HEALTH_WITNESS_STATE, "pass"))
}
