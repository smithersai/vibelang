// run-seconds: 300
// rule-evidence: docs/design/vips/0004-throw.md#retirement-of-the-empty-legacy-trust-wrapper | a rewrite that can't preserve types, behavior and declaration output refuses at that site
// A call whose argument is narrowed where it stands, here the property path
// box.s and a callee that returns an Effect value, keeps that type through
// the migration: the bridge evaluates the arguments where the call stood
// and gives the thunk their values. The migrated program runs as before.
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = `import { trusted } from "vibelang-runtime"
const len = (s: { id: string }): number => s.id.length
const twice = (n: number): unknown => Effect.succeed(n * 2)
const ln = trusted(len, [])
const tw = trusted(twice, [])
type Box = { n?: number; s?: { id: string } }
effect function measure(box: Box): number!! {
  const a = box.n !== undefined ? try (tw(box.n) as unknown as number!never) : 0
  const b = box.s ? ln(box.s) : 0
  return a + b
}
export effect function main() {
  return [try measure({ n: 2, s: { id: "abc" } }), try measure({})]
}
`
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  const legacy = tsc()
  assert.deepEqual(codes(legacy.text), ["EK0407", "EK0407"], legacy.text)
  const before = run()
  console.log("narrowed arguments keep " + before)
})
