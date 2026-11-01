import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as actual from "./out/main.js"

execFileSync(process.execPath, [resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc"),
  "-p", fileURLToPath(new URL("./reference", import.meta.url)), "--pretty", "false"], {stdio:"inherit"})
const stock = await import("./reference/out/main.js")
const lexical = new Set(["let_simple", "let_array", "let_object", "let_nested", "let_multiple", "const_simple", "const_array", "const_object", "const_nested", "const_multiple"])
const errors = []
let comparisons=0
for (const name of Object.keys(stock)) {
  for (const count of [0,1,2]) {
    for (const jump of ["exhaust","break","continue"]) {
      const label = name+"/"+count+"/"+jump
      const expected = stock[name](count,jump)
      // Check the stock oracle's meaning as well as the differential result.
      if(lexical.has(name)) {
        for(const event of expected.trace.filter(s=>s!== "fallthrough")) {
          assert.ok(event.endsWith(":ReferenceError"), label+": "+event)
        }
        const iterations = jump==="break" ? Math.min(count,1) : count
        assert.deepEqual(expected.cells, Array.from({length:iterations},(_,i)=>i+1+(name.startsWith("const") ? 0 : 10)),label)
      } else {
        assert.deepEqual(expected.cells, Array(jump==="break" ? Math.min(count,1) : count).fill(99),label)
      }
      try { assert.deepEqual(actual[name](count,jump),expected,label) }
      catch(e) { errors.push(e.message) }
      comparisons++
    }
  }
}
assert.equal(errors.length,0,errors.length+" mismatches; first witnesses:\n"+errors.slice(0,2).join("\n"))
console.log(comparisons+" stock TypeScript TDZ comparisons passed")
