import assert from "node:assert/strict"
import { test } from "node:test"
import { read, run } from "./spec-witness.mjs"

// Loop round 4, OPUS-5 (decided detail 198 with VIP-39's transparent
// containers): a `do` that jumps out of a JSX element is evaluated after
// everything to its left in the element, once each, and never moves alone.
const vip = read("docs/design/vips/0039-vibex.md")

test("VIP-39 row 33 states the prefix order for an outward-jumping do", () => {
  const row = vip.split("\n").find(l => l.startsWith("| 33 | "))
  assert.ok(row.includes("everything before it in the element (the tag, earlier attributes, spreads and children) is evaluated first, once, in source order"))
  assert.ok(row.includes("the `do` never moves alone"))
  assert.ok(row.includes("Under `preserve` and `react-native` those earlier values reach the framework as values"))
  assert.match(read("docs/design/src/002-running.md"), /<a id="evaluation-order"><\/a>\*\*Evaluation order\.\*\*[^\n]*Everything to its left runs first, in source order/)
})

// The row's lowering, written out by hand for
//   <Box {...rec("tag", {})} a={rec("a", 1)} {...rec("b", {})} v={do { if (c) return 7; rec("v", 1) }} z={rec("z", 2)} />
// with a recording factory: the jump records the prefix once and builds nothing.
const reference = `
const log: string[] = []
const rec = <T,>(s: string, v: T): T => (log.push(s), v)
const h = (tag: unknown, props: Record<string, unknown>) => (log.push("build"), { tag, props })
const Box = "Box"
function lowered(c: boolean) {
  const tag0 = Box
  const s0 = { ...rec("tag", {}) }
  const a0 = rec("a", 1)
  const s1 = { ...rec("b", {}) }
  if (c) return 7
  const v0 = rec("v", 1)
  return h(tag0, { ...s0, a: a0, ...s1, v: v0, z: rec("z", 2) })
}
const jump = (log.length = 0, [lowered(true), [...log]])
const stay = (log.length = 0, [typeof lowered(false), [...log]])
console.log(JSON.stringify({ jump, stay }))
`

test("the hand lowering records the prefix once and builds nothing on a jump", () => {
  const out = run(reference)
  assert.equal(out.status, 0, out.stderr)
  assert.deepEqual(JSON.parse(out.stdout), { jump: [7, ["tag", "a", "b"]], stay: ["object", ["tag", "a", "b", "v", "z", "build"]] })
})
