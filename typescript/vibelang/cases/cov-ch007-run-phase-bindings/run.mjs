// Chapter 007 / run-phase-bindings: docs/design/src/007-tooling.md#6eefb2c31fd7eb98
import assert from "node:assert/strict"
import {createRequire} from "node:module"
const fc=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))("fast-check")
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { originalFunctions, runPhaseOf } from "../../../../.smithers/flows/migrate/lib/run-phase.mjs"
const samples=[
 ["shadowed-gen","const Effect={gen:()=>7}; export function f(){return Effect.gen()}",7],
 ["eager-argument","import {Effect} from 'effect'; let calls=0; function makeGenerator(){calls++;return function*(){return 7}}; export function f(){return Effect.gen(makeGenerator())}",null],
]
const failures=[]
for(const [key,source,value] of samples){
 const shape=originalFunctions(ts,source).get("f")
 assert.equal(shape.kind,"plain",key)
 const verdict=runPhaseOf(ts,shape.node).verdict
 try {assert.notEqual(verdict,"ok",key+": binding/argument work cannot be certified cold by callee spelling")}catch(error){failures.push(error.message)}
 if(value!==null){const js=ts.transpileModule(source.replace("export ",""),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;assert.equal(Function(js+";return f()")(),value)}
}
fc.assert(fc.property(fc.constantFrom(...samples),fc.constantFrom("Effect","Micro","Stream"),([key,text],name)=>{
 const source=text.replaceAll("Effect",name)
 const shape=originalFunctions(ts,source).get("f")
 assert.notEqual(runPhaseOf(ts,shape.node).verdict,"ok",key+": callee spelling is not binding provenance")
}),{seed:7007372,numRuns:12})
assert.deepEqual(failures,[])
console.log("ok")
