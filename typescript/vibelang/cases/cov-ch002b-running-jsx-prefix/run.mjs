import assert from "node:assert/strict"
import fs from "node:fs"
import {createRequire} from "node:module"
import {Effect} from "effect"
const ts=createRequire(import.meta.resolve("effect"))("typescript")
for(const prefix of ["out","typescript/out"]){
 const input=new URL("./"+prefix+"/main.jsx",import.meta.url)
 fs.writeFileSync(new URL("./"+prefix+"/main.js",import.meta.url),ts.transpileModule(fs.readFileSync(input,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:"h"}}).outputText)
}
const {main}=await import("./out/main.js")
const {main:native}=await import("./typescript/out/main.js")
const observe=async f=>JSON.parse(JSON.stringify(await Effect.runPromiseExit(f())))
assert.deepEqual(await observe(main),await observe(native))
assert.deepEqual(await Effect.runPromise(main()),[[7,["tag","attribute","spread"]],[{props:{a:2,s:3,v:1},children:[]},["tag","attribute","spread","body","h"]]])
console.log("JSX preserve prefix Exit parity")
