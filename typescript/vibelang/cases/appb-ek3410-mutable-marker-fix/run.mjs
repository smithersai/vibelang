// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK3410` | retired `mutable` marker on an ordinary type member or plain-error payload; run `vibelang --fix` to remove redundant markers or preserve payloads in a compatibility class; enforce after preserving migration | 34 | [Migration](007-tooling.md#ordinary-mutable-marker-migration) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "export type T = { mutable x: number }\nexport error E { mutable n: number }\nexport effect function main() {\n  const t: T = { x: 1 }\n  t.x = 2\n  const e = new E({ n: 3 })\n  return [t.x, e.n, e._tag, e instanceof E]\n}\n"
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  assert.equal(tsc().status, 0)
  const before = run()
  const declaration = read("out/main.d.ts")
  console.log("EK3410 mutable migration keeps " + before)
})
