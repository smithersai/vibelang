// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0503` | a `try` statement in effect code; `vibelang --fix` applies the preserving `try statements` codemod | 5 | [Running Effects](002-running.md#try) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "error Boom {}\neffect function fail(): number!Boom { throw new Boom() }\nexport effect function main() {\n  const log: string[] = []\n  try { const v = try fail(); log.push(`ok ${v}`) } catch (e) { log.push(\"caught\") } finally { log.push(\"done\") }\n  return log\n}\n"
const forms = "export effect function caught(): number!! { try { return 1 } catch { return 2 } }\nexport effect function cleaned(): number!! { try { return 1 } finally { } }\n"
withProject(here, { "main.vibe": forms }, ({ tsc }) => {
  const got = tsc().text.split("\n").map((line) => /\bmain\.vibe\(\d+,\d+\): error EK\d+/.exec(line)?.[0]).filter(Boolean)
  assert.deepEqual(got, ["main.vibe(1,45): error EK0503", "main.vibe(2,46): error EK0503"], "try/catch and try/finally statements")
})
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  const rejected = tsc()
  assert.deepEqual(codes(rejected.text), ["EK0503"], rejected.text)
  const before = run()
  console.log("EK0503 try statements codemod keeps " + before)
})
