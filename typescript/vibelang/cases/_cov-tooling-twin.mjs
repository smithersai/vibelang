import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

// Compare exported call signatures and the specified Exit observations using
// the requested stock pins. Defect messages/stacks are presentation details.
export async function compareTwin(url, name, samples, observe = value => value) {
  const caseDir = dirname(fileURLToPath(url)), root = mkdtempSync(join(tmpdir(), "cov-tooling-twin-"))
  try {
    assert.equal(ts.version, "5.9.3")
    let effect = process.env.EFFECT_410_NODE_MODULES ? join(process.env.EFFECT_410_NODE_MODULES,"effect") : fileURLToPath(new URL("../../.cache/effect-4.1.0/node_modules/effect",import.meta.url))
    mkdirSync(join(root,"node_modules"))
    if (!existsSync(join(effect,"package.json")) && !process.env.EFFECT_410_NODE_MODULES) {
      const install=spawnSync("npm",["install","--prefix",root,"--ignore-scripts","--no-audit","--no-fund","--no-save","--package-lock=false","effect@4.1.0"],{cwd:root,encoding:"utf8",timeout:90000})
      assert.ifError(install.error);assert.equal(install.status,0,"stock Effect install: "+install.stdout+install.stderr)
      effect=join(root,"node_modules/effect")
    }
    assert.equal(JSON.parse(readFileSync(join(effect,"package.json"),"utf8")).version,"4.1.0")
    if(effect!==join(root,"node_modules/effect"))symlinkSync(effect,join(root,"node_modules/effect"))
    writeFileSync(join(root,"package.json"),'{"type":"module"}')
    for (const file of readdirSync(join(caseDir,"typescript")).filter(f=>f.endsWith(".ts"))) writeFileSync(join(root,file),readFileSync(join(caseDir,"typescript",file),"utf8"))
    const compiled=spawnSync(process.execPath,[fileURLToPath(new URL("../../../docs/tools/node_modules/typescript/bin/tsc",import.meta.url)),"--target","ES2022","--module","NodeNext","--strict","--skipLibCheck","--declaration","--outDir","out","main.ts"],{cwd:root,encoding:"utf8",timeout:30000})
    assert.ifError(compiled.error);assert.equal(compiled.status,0,compiled.stdout+compiled.stderr)
    const signature = file => {
      const program=ts.createProgram([file],{types:[],skipLibCheck:true,noEmit:true,module:ts.ModuleKind.NodeNext})
      const c=program.getTypeChecker(),s=program.getSourceFile(file)
      const symbol=c.getExportsOfModule(c.getSymbolAtLocation(s)).find(s=>s.name===name)
      assert.ok(symbol,name)
      return c.getTypeOfSymbolAtLocation(symbol,s).getCallSignatures().map(sig=>({
        parameters:sig.parameters.map(p=>c.typeToString(c.getTypeOfSymbolAtLocation(p,s))),
        returns:c.typeToString(c.getReturnTypeOfSignature(sig))
      }))
    }
    assert.deepEqual(signature(join(caseDir,"out/main.d.ts")),signature(join(root,"out/main.d.ts")),"stock declaration call signatures")
    const reference=await import(pathToFileURL(join(root,"out/main.js")).href)
    const actual=await import(pathToFileURL(join(caseDir,"out/main.js")).href)
    const NativeEffect=await import(pathToFileURL(createRequire(join(root,"probe.cjs")).resolve("effect/Effect")).href)
    const VibeEffect=await import(pathToFileURL(createRequire(join(caseDir,"probe.cjs")).resolve("effect/Effect")).href)
    for(const sample of samples) {
      const a=await observe(actual[name],VibeEffect,sample)
      const b=await observe(reference[name],NativeEffect,sample)
      assert.deepEqual(a,b,"stock Exit observation for "+JSON.stringify(sample))
    }
    console.error(JSON.stringify({stage:"stock-twin",typescript:ts.version,effect:"4.1.0",types:"equal",exit:"equal",samples:samples.length}))
  }finally{rmSync(root,{recursive:true,force:true})}
}
export const exitView = exit => exit._tag === "Success" ? { _tag:"Success",value:exit.value } : { _tag:"Failure",reasons:exit.cause.reasons.map(r=>r._tag) }
