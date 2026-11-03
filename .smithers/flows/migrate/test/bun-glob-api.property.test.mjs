import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,writeFileSync,rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { addBunBuildGlobs } from "../lib/bun-globs.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
// Reduced external Bun scanner contract. Compare method and instance types
// rather than declaration text or the generated helper's spelling.
const ambient=`declare namespace Bun {
  interface ScanOptions { cwd?: string; absolute?: boolean }
  class Glob {
    constructor(pattern: string);
    readonly pattern: string;
    scanSync(options?: string | ScanOptions): IterableIterator<string>;
    scan(options?: string | ScanOptions): AsyncIterableIterator<string>;
  }
  function build(options: {entrypoints: string[]}): Promise<{success: boolean}>;
}`
function check(inputs) {
 const root=mkdtempSync(join(tmpdir(),"bun-glob-api-"))
 try {
  writeFileSync(join(root,"ambient.d.ts"),ambient)
  let probe='type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;\n'
  inputs.forEach((input,i)=>{
   const ext=input.js?"mjs":"ts",name="scanner"+i
   const source=(input.collision?'const __vibelangBuildGlob = 1;\n':"")+
    `export const ${name}=new Bun.Glob("**/*.ts"); export const entries=[...${name}.scanSync()]; export function build(){return Bun.build({entrypoints:entries})}\n`
   writeFileSync(join(root,`before${i}.${ext}`),source)
   writeFileSync(join(root,`after${i}.${ext}`),addBunBuildGlobs(source,ts,"build."+ext).text)
   const imported=ext==="ts"?"js":ext
   probe+=`import { ${name} as A${i} } from "./before${i}.${imported}"; import { ${name} as B${i} } from "./after${i}.${imported}";
const sync${i}: Equal<typeof A${i}.scanSync,typeof B${i}.scanSync> = true;
const async${i}: Equal<typeof A${i}.scan,typeof B${i}.scan> = true;
const instance${i}: Equal<typeof A${i},typeof B${i}> = true;
`
  })
  writeFileSync(join(root,"probe.ts"),probe)
  const program=ts.createProgram([join(root,"probe.ts"),join(root,"ambient.d.ts")],{
   strict:true,noEmit:true,allowJs:true,checkJs:true,noImplicitOverride:true,
   target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
   types:[],lib:["lib.esnext.d.ts"],skipLibCheck:false
  })
  const diagnostics=ts.getPreEmitDiagnostics(program)
  assert.deepEqual(diagnostics.map(d=>d.code+": "+ts.flattenDiagnosticMessageText(d.messageText," ")),[],
   "build entry wiring preserves the original scanner's method and instance types")
 } finally {rmSync(root,{recursive:true,force:true})}
}
test("Bun entry scanners retain exported TypeScript and JavaScript SDK types",()=>check([{js:false,collision:false},{js:true,collision:true}]))
test("property: exported scanner types retain the host SDK contract across generated bindings",()=>{
 fc.assert(fc.property(fc.array(fc.record({js:fc.boolean(),collision:fc.boolean()}),{minLength:4,maxLength:6}),check),
  {seed:820183,numRuns:6})
})
