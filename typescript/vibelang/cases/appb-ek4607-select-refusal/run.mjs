// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4607` | retired `select` block; `vibelang --fix` refuses an unproved selection rewrite | 18 (removal only) | [Retirement](000-intro.md#retired-continuation-forms) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "export effect function main() { select { default: return 1 } }\n"
withProject(here, { "main.vibe": input }, ({ tsc, read }) => {
  const rejected = tsc()
  assert.deepEqual(codes(rejected.text), ["EK4607"], rejected.text)
  assert.match(rejected.text, /select is outside the first release/)
  assert.deepEqual(codes(tsc().text), ["EK4607"])
  console.log("EK4607 select is rejected and its rewrite refused")
})
