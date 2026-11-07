import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join } from "node:path"
import { sidecarChanges } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const corpus=JSON.parse(readFileSync(new URL("../corpus/t3code-independent-sidecar-unavailable.json",import.meta.url),"utf8"))
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/sidecar-availability-"))
const put=(f,t)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,t)}
try {
 const usesBad=["unrelated-error","changed-with-error","doc-with-error","dependent-error"].includes(key)
 const suffix=mode&1?"Item":"",good="good"+suffix,bad="bad"+suffix
 let g=corpus.good.replaceAll("good",good),b=corpus.bad.replaceAll("bad",bad)
 if(mode&2){g=g.replace("number","{ readonly value: number }");b=b.replace("MissingType","{ readonly value: MissingType }")}
 if(key==="dependent-error")g='import type { '+bad+' } from "./bad.js";\nexport declare const '+good+': typeof '+bad+';\n'
 const doc=mode&4?"/** First documentation. */\n":""
 g=doc+g
 const old={"src/good.d.vibe.ts":g}
 if(usesBad||key==="missing-entry")old["src/bad.d.vibe.ts"]=b
 const out=join(root,"emitted"),prefix=mode&8?"tsconfig.lib.json/":""
 const candidate=["changed-with-error","changed-clean"].includes(key)?g.replaceAll("number","string"):["doc-with-error","doc-clean"].includes(key)?(doc?g.replace("First documentation.","Changed documentation."):"/** Changed documentation. */\n"+g):g
 put(join(out,prefix+"good.d.ts"),candidate)
 if(usesBad)put(join(out,prefix+"bad.d.ts"),b)
 const originals=join(root,"originals")
 put(join(originals,"good.d.ts"),g)
 if(usesBad)put(join(originals,"bad.d.ts"),b)
 const files=[join(originals,"good.d.ts"),...(usesBad?[join(originals,"bad.d.ts")]:[])]
 const program=ts.createProgram(files,{strict:true,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,noEmit:true,lib:["lib.es2022.d.ts"]})
 const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>({code:d.code,file:d.file?.fileName.split("/").at(-1)}))
 assert.deepEqual([...new Set(diagnostics.map(d=>d.code))],[...(usesBad?[2304]:[])],JSON.stringify(diagnostics))
 assert.ok(diagnostics.every(d=>d.file==="bad.d.ts"),JSON.stringify(diagnostics))
 const candidateRoot=join(root,"candidate-control")
 put(join(candidateRoot,"good.d.ts"),candidate)
 if(usesBad)put(join(candidateRoot,"bad.d.ts"),b)
 const candidateProgram=ts.createProgram(files.map(f=>f.replace(originals,candidateRoot)),program.getCompilerOptions())
 function nativeSurface(p,file){const c=p.getTypeChecker(),s=p.getSourceFile(file),symbol=c.getExportsOfModule(c.getSymbolAtLocation(s)).find(x=>x.name===good);assert.ok(symbol);return {type:c.typeToString(c.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration)),doc:ts.displayPartsToString(symbol.getDocumentationComment(c))}}
 const nativeBefore=nativeSurface(program,join(originals,"good.d.ts")),nativeAfter=nativeSurface(candidateProgram,join(candidateRoot,"good.d.ts"))
 assert.equal(nativeBefore.type!==nativeAfter.type,["changed-clean","changed-with-error"].includes(key),JSON.stringify({key,nativeBefore,nativeAfter}))
 assert.equal(nativeBefore.doc!==nativeAfter.doc,["doc-clean","doc-with-error"].includes(key),JSON.stringify({key,nativeBefore,nativeAfter}))
 const tree=()=>{const r={};const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(dir,e.name);if(e.isDirectory())walk(f);else r[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return r}
 const before=tree(),result=sidecarChanges(ts,old,out),after=tree()
 const unavailable=result.unavailable??[],held=(entry,name)=>unavailable.some(u=>u.entrypoint===entry&&u.export===name&&u.blocking&&u.scope==="export")
 const expectBad=usesBad,expectGood=key==="dependent-error",expectChanged=["changed-with-error","doc-with-error","changed-clean","doc-clean"].includes(key)
 const changed=result.changed.map(c=>c.file),missing=result.missing
 const ok=result.comparisonComplete!==false&&held("src/bad.d.vibe.ts",bad)===expectBad&&held("src/good.d.vibe.ts",good)===expectGood&&JSON.stringify(changed)===JSON.stringify(expectChanged?["src/good.d.vibe.ts"]:[])&&JSON.stringify(missing)===JSON.stringify(key==="missing-entry"?["src/bad.d.vibe.ts"]:[])
 const knownGap=!ok&&result.comparisonComplete===false&&result.changed.length===0&&result.missing.length===0&&expectBad&&(result.environmentDiagnostics??[]).length>0&&(result.environmentDiagnostics??[]).every(d=>d.blocking&&((d.diagnostic.startsWith("TS2304:")&&d.file?.split("/").at(-1)==="bad.d.ts")||(d.entrypoint&&["src/good.d.vibe.ts","src/bad.d.vibe.ts"].includes(d.entrypoint)&&d.diagnostic.startsWith("Compared export depends on an unresolved or erroneous type"))))
 console.log(JSON.stringify({ok,knownGap,nativeBefore,nativeAfter,unchanged:JSON.stringify(before)===JSON.stringify(after),key,mode,diagnostics,result}))
} finally {rmSync(root,{recursive:true,force:true})}
