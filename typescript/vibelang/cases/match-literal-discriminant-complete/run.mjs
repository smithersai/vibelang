import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"
import { complete, fallback, nested, mixed, message, classes, circle } from "./out/main.js"
assert.equal(complete({kind:"circle",r:2}),2)
assert.equal(complete({kind:"square",side:3}),3)
assert.equal(fallback({kind:"square",side:3}),0)
assert.equal(nested({value:{type:"b"}}),2)
assert.equal(mixed({kind:"b"}),2)
assert.equal(message(new Error("boom")),"boom")
assert.equal(classes(circle(1)),1)
assert.throws(()=>classes({kind:"circle",r:1}),e=>e instanceof TypeError)
// VIP-7: reporting a missing case never changes the tests emitted at runtime.
// rule-evidence: docs/design/src/004-match.md#exhaustiveness
// rule-evidence: docs/design/src/004-match.md#exhaustiveness | Each member must be finite through a required literal field, or through a literal or nested finite field tested by its patterns; a broad discriminant such as `kind: string` leaves the domain open.
project(({ put, invoke, run, stock, exists }) => {
 const shape = 'type Shape = {kind:"circle";r:number}|{kind:"square";side:number};'
 put("main.vibe", shape + 'export function area(s:Shape):number{return match(s){when {kind:"circle",let r}:r;}}')
 put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmitOnError: false }, files: ["main.vibe"] })
 const emitted = invoke("-p", ".", "--pretty", "false")
 assert.deepEqual(diagnostics(emitted.text), ["error EK4701"], emitted.text)
 assert.notEqual(emitted.status, 0)
 assert.match(emitted.text, /square/)
 const runtime = run(process.execPath, ["--input-type=module", "-e",
  'import assert from "node:assert/strict";import {area} from "./out/main.js";assert.equal(area({kind:"circle",r:2}),2);assert.throws(()=>area({kind:"square",side:2}),e=>e instanceof TypeError && e.message==="")'])
 assert.equal(runtime.status, 0, runtime.text)
 const blocked = invoke("-p", ".", "--pretty", "false", "--noEmitOnError", "true", "--outDir", "blocked")
 assert.deepEqual(diagnostics(blocked.text), ["error EK4701"], blocked.text)
 assert.notEqual(blocked.status, 0)
 assert.equal(exists("blocked/main.js"), false)
 put("twin.ts", shape + 'export function area(s:Shape):number{switch(s.kind){case "circle":return s.r;}}')
 const twin = stock("--strict", "--noEmit", "--skipLibCheck", "--target", "ES2022", "twin.ts")
 assert.notEqual(twin.status, 0)
 assert.match(twin.text, /TS2366/)
})
console.log("complete literal discriminants")
