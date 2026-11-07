// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0407` | the retired resolved `trusted(f, [])` wrapper; use the preserving `vibelang --fix` migration or a reviewed `.ts` helper with `@throws {never}` before rejection | 4 | [Migration](007-tooling.md#empty-legacy-trust-wrappers) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "import { trusted } from \"vibelang-runtime\"\nfunction f(x: number) { return x + 1 }\nconst g = trusted(f, [])\nexport effect function main() { return g(1) }\n"
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  // The retired wrapper is an error before the fix; the legacy output still runs.
  const legacy = tsc()
  assert.notEqual(legacy.status, 0, legacy.text)
  assert.deepEqual(codes(legacy.text), ["EK0407"], legacy.text)
  const before = run()
  const fixed = tsc("--fix")
  assert.equal(fixed.status, 0, fixed.text)
  assert.match(fixed.text, /trusted empty-list migration/)
  const after = read("main.vibe")
  assert.doesNotMatch(after, /trusted\(f, \[\]\)/)
  assert.match(after, /Effect\.orDie\(Effect\.try\(/)
  assert.equal(tsc().status, 0, "the migrated program compiles")
  assert.equal(run(), before, "the migration keeps the success value")
  assert.equal(tsc("--fix").status, 0)
  assert.equal(read("main.vibe"), after, "the migration reaches a fixed point")
  console.log("EK0407 fix keeps " + before)
})
