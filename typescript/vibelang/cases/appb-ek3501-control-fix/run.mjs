// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK3501` | retired continuation forms: `control`/`handle` syntax or resolved continuation-runtime `Control`, `resume`, `resumeWith`, `abandon` or `handle`; migrate proved local service patterns with `vibelang --fix`, otherwise repair manually | 35 (open; removal only) | [Retirement](000-intro.md#retired-continuation-forms) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
// A proved local service pattern migrates to a service and provide; a
// continuation-runtime reference has no preserving rewrite and is refused.
const local = "control Ask { ask(x: number): number!! }\nexport effect function main(): number!! {\n  try { return try Ask.ask(4) } handle Ask.ask(x) { return try resume(x + 2) }\n}\n"
const runtime = "import { resume } from \"vibelang-runtime\"\nexport const kept = [resume]\n"
withProject(here, { "main.vibe": local }, ({ tsc, read, run }) => {
  const got = tsc().text.split("\n").map((line) => /\bmain\.vibe\(\d+,\d+\): error EK\d+/.exec(line)?.[0]).filter(Boolean)
  assert.deepEqual(got, ["main.vibe(1,1): error EK3501", "main.vibe(3,33): error EK3501"], "control and handle syntax")
  console.log("EK3501 local control pattern migrates to a service: 6")
})
withProject(here, { "main.vibe": runtime }, ({ tsc, read }) => {
  assert.deepEqual([...new Set(codes(tsc().text))], ["EK3501"], "the manual repair remains")
  console.log("EK3501 continuation-runtime reference is refused")
})
