// run-seconds: 300
// 001-functions.md, Declaration output, Specifiers: "Ordinary package
// declarations use the native twin's relative specifiers: `./user.vibe` is
// declared as `./user.ts` and `./App.vibex` as `./App.tsx` ... Compatibility
// sidecars instead keep VibeLang source references such as `./user.vibe` and
// `./App.vibex`." The twin below is the .vibex module's TypeScript twin, which
// writes ./App.tsx; stock tsc keeps that spelling in written specifiers, in
// import() types and in the import types it synthesizes. A consumer that only
// has the package's build/ output must resolve every declaration. The native
// callable carries the generated nonthrowing contract required by VIP-27.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const app = "export interface Shape { readonly n: number }\nexport const makeApp = (): Shape => ({ n: 1 })\nexport const App = 7\n"
const main = (target) => [
 `export { App } from "${target}"`,
 `import { makeApp } from "${target}"`,
 target.endsWith(".tsx") ? "/** @throws {never} */\nexport const app = () => makeApp()" : "export const app = () => makeApp()",
 `export * as ns from "${target}"`,
 `export type Alias = import("${target}").Shape`,
].join("\n") + "\n"

for(const [jsx,extension] of [["preserve",".jsx"],["react-jsx",".js"]]) {
 for(const moduleKind of [["ESNext","Bundler"],["NodeNext","NodeNext"]]) {
  const options={compilerOptions:{module:moduleKind[0],moduleResolution:moduleKind[1],jsx,noEmit:false,declaration:true,allowArbitraryExtensions:true,rewriteRelativeImportExtensions:true}}
  const tag=jsx+"-"+moduleKind[0].toLowerCase()
  const p=project(import.meta.url,"vibe-"+tag,{"main.vibe":main("./App.vibex"),"App.vibex":app},options)
  const actual=check(p)
  const native=project(import.meta.url,"native-"+tag,{"main.ts":main("./App.tsx"),"App.tsx":app},options)
  const reference=nativeCheck(native)
  assert.equal(reference.status,0,reference.output)
  assert.equal(actual.status,0,actual.output)
  assert.equal(p.read("build/main.d.ts").trim(),native.read("build/main.d.ts").trim(),tag)
  assert.ok(fs.existsSync(path.join(p.dir,"build","App"+extension)))
  // The compatibility sidecar keeps the source reference.
  assert.match(p.read("main.d.vibe.ts"),/from "\.\/App\.vibex"/)
  // A stock TypeScript consumer of the package output alone.
  const consumer=project(import.meta.url,"consumer-"+tag,{
   "use.ts":'import { App, app, ns, type Alias } from "./lib/main.js"\nexport const total: number = App + app().n + ns.App\nexport const alias: Alias = { n: 2 }\n'},
   {compilerOptions:{module:moduleKind[0],moduleResolution:moduleKind[1],noEmit:true,declaration:false}})
  fs.cpSync(path.join(p.dir,"build"),path.join(consumer.dir,"lib"),{recursive:true})
  const used=nativeCheck(consumer)
  assert.equal(used.status,0,tag+"\n"+used.output)
 }
}

// Spec rule: docs/design/src/001-functions.md#ee61d9a503677298
// Chapter 001: declaration-path.
console.log("coverage-ok")
