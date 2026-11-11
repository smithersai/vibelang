import assert from "node:assert/strict"
import { test } from "node:test"
import { hostGap } from "./durable-host-gap.mjs"

// smthrs prints its failure as JSON, so the loader's message arrives escaped.
const fault = (detail) => JSON.stringify({
  code: "HarnessError",
  message: `read_failed: PermissionDenied: FileSystem.read (/project/.smithers/memory-thresholds.json): descriptor-relative filesystem isolation failed closed: AtomicHelperFault: ${detail}\n`
}, null, 2)

test("a helper the loader refuses for a missing C library version is a host gap", () => {
  const detail = "atomic helper exited 1: /tmp/helper/smithers-jj-export: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found (required by /tmp/helper/smithers-jj-export)"
  const reason = "this host's C library lacks GLIBC_2.39, which the smthrs native helper needs"
  assert.equal(hostGap(fault(detail)), reason)
  assert.equal(hostGap(JSON.stringify(fault(detail))), reason)
})

test("every other failure is not a host gap", () => {
  for (const output of [
    "",
    JSON.stringify({ status: "failed" }),
    fault("atomic helper exited 1: /tmp/helper/smithers-jj-export: No such file or directory"),
    fault("atomic helper exited 2: refused a path outside the project"),
    "invalid_input issue=Cannot load flow migrate: flow \"migrate\" runs code this host cannot pin",
    "version `GLIBC_2.39' not found"
  ]) assert.equal(hostGap(output), undefined, output)
})
