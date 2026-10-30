import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { Defaults, result } from "./out/main.js"
assert.deepEqual(result, ["literal/Keyed", 4])
assert.deepEqual(await Effect.runPromise(Effect.service(Defaults)), {n: 3})
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
function check(name) {
  const project = fileURLToPath(new URL(name + "/tsconfig.json", import.meta.url))
  const checked = spawnSync(compiler, ["-p", project, "--noEmit", "--pretty", "false"], {encoding:"utf8"})
  assert.equal(checked.error, undefined)
  const output = checked.stdout + checked.stderr
  assert.notEqual(checked.status, 0, output)
  const rows = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
  assert(rows.length > 0, output)
  return {rows, output}
}
const {rows, output} = check("input")
assert.equal(rows.length, 13, output)
assert.deepEqual(rows.map(m => Number(m[1])).sort((a,b) => a-b), Array.from({length:13},(_,i) => i+1), output)
assert(rows.every(m => m[2] === "EK" && Number(m[3]) === 902), output)
const literal = check("key-literals")
assert(!literal.rows.some(m => m[2] === "EK" && Number(m[3]) === 902), literal.output)
assert.equal(literal.rows.filter(m => m[2] === "EK" && [901,3008].includes(Number(m[3]))).length, 3, literal.output)
console.log("reserved service properties validated")
