import { test } from "node:test"
import assert from "node:assert/strict"

for (const name of ["same name", "  same name  ", "same  name", "\tsame name\t", "same\tname", "first\n second "]) {
  test(name, () => assert.equal(process.env.CI_HEALTH_WITNESS_STATE, "pass"))
}
