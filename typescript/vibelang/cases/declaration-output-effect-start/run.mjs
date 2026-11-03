// run-seconds: 180
import assert from "node:assert/strict"
import {readFileSync,writeFileSync,unlinkSync} from "node:fs"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"start",[0],async(fn,E)=>exitView(await E.runPromiseExit(fn())))
const declaration=readFileSync(new URL("./out/main.d.ts",import.meta.url),"utf8")
assert.match(declaration,/export declare function start/);assert.match(declaration,/Effect\.Effect</);assert.doesNotMatch(declaration,/@throws/)
const file=new URL("./stock-consumer.ts",import.meta.url)
try {
writeFileSync(file,'import {start} from "./main.vibe"; export const program = start();')
const p=ts.createProgram([file.pathname],{noEmit:true,allowArbitraryExtensions:true,strict:true,types:[],skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext})
assert.deepEqual(ts.getPreEmitDiagnostics(p).map(d=>d.code),[])
}finally{unlinkSync(file)}
console.log("declaration-output-effect-start")
