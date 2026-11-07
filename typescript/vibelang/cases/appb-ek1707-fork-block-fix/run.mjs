// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1707` | a bare `fork { … }` block; write `fork effect { … }` or use the `fork blocks` codemod before rejection | 2, 17 | [Migration](007-tooling.md#legacy-fork-try-statement-and-wire-migration) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "export effect function main() {\n  const fiber = fork { return 1 }\n  return [join fiber]\n}\n"
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  assert.equal(tsc().status, 0)
  const before = run()
  const fixed = tsc("--fix")
  assert.equal(fixed.status, 0, fixed.text)
  assert.match(fixed.text, /fork blocks/)
  const after = read("main.vibe")
  assert.match(after, /fork effect \{ return 1 \}/)
  assert.deepEqual(codes(tsc().text), [], "the codemod leaves no diagnostic")
  assert.equal(run(), before, "the codemod keeps the success value")
  assert.equal(tsc("--fix").status, 0)
  assert.equal(read("main.vibe"), after, "the codemod reaches a fixed point")
  console.log("EK1707 fork blocks codemod keeps " + before)
})
