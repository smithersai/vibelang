import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join } from "node:path"
import { spawnSync } from "node:child_process"
import { applyPlainEdits,markPlainFunctions,plainEdits } from "../../../../../../.smithers/flows/migrate/lib/plain.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/alchemy-native-peer-effect-factory.json",import.meta.url),"utf8"))
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/native-peer-inference-"))
const put=(f,t)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,t)}
try {
 const modern=key.startsWith("modern"),native=!key.startsWith("ts-"),signature=key.endsWith("sidecar"),effect=key.includes("effect")
 const stem=mode&1?"peerδ":"peer",normal=text=>mode&2?text.replaceAll("\n","\r\n"):text
 let peer=effect?fixture.peer:fixture.peer.replace("Effect.succeed(n)","n + 1")
 let caller=fixture.caller.replaceAll("./peer.ts","./"+stem+".ts")
 if(mode&4)caller="// Native peer inference control.\n"+caller
 if(mode&8)caller=caller.replace('import { consume }','import * as Peer').replace('=> consume(n)','=> Peer.consume(n)')
 const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:true,types:[],lib:["lib.es2022.d.ts"],allowImportingTsExtensions:true,allowArbitraryExtensions:true,noEmit:true}
 const init=dir=>{put(join(dir,"package.json"),'{"type":"module"}');symlinkSync(join(process.cwd(),"packages/runtime/node_modules"),join(dir,"node_modules"),"dir")}
 const original=join(root,"original"),candidate=join(root,"candidate");init(original);init(candidate)
 put(join(original,stem+".ts"),normal(peer));put(join(original,"main.ts"),normal(caller))
 const wanted=effect?'import("effect/Effect").Effect<number>':"number"
 put(join(original,"check.ts"),'import { program } from "./main.js";\nconst checked: '+wanted+' = program(1);\nexport {checked};\n')
 const control=ts.createProgram([join(original,"main.ts"),join(original,"check.ts")],options),controlErrors=ts.getPreEmitDiagnostics(control).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.code)
 assert.deepEqual(controlErrors,[],JSON.stringify({key,mode,controlErrors}))
 const originalSF=control.getSourceFile(join(original,"main.ts")),originalChecker=control.getTypeChecker()
 let declaration;ts.forEachChild(originalSF,n=>{if(ts.isVariableStatement(n))declaration=n.declarationList.declarations.find(d=>d.name.getText(originalSF)==="program")})
 assert.ok(declaration);const originalType=originalChecker.getTypeAtLocation(declaration.name).getCallSignatures()[0].getReturnType();assert.equal(Boolean(originalType.flags&(ts.TypeFlags.Any|ts.TypeFlags.Unknown)),false)
 const peerFile=join(candidate,stem+(native?".vibe":".ts"));put(peerFile,normal(peer));caller=caller.replaceAll(stem+".ts",stem+(native?".vibe":".ts"));put(join(candidate,"main.ts"),normal(caller))
 const config={compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,types:[],lib:["ES2022"],allowArbitraryExtensions:true,allowImportingTsExtensions:true,noEmit:true},files:["main.ts"]};put(join(candidate,"tsconfig.json"),JSON.stringify(config))
 const nativeControls=[];let sidecarOrigin=null
 const compiler=join(process.cwd(),"packages/compiler/native/vibelang")
 if(native&&mode===0){
  const check=spawnSync(compiler,["-p",join(candidate,"tsconfig.json"),"--singleThreaded","--pretty","false"],{encoding:"utf8",timeout:120000,env:process.env});assert.equal(check.status,0,JSON.stringify({key,stdout:check.stdout,stderr:check.stderr,error:check.error?.message}));nativeControls.push({code:check.status,mode:"noEmit"})
 }
 if(signature){
  const emitConfig={compilerOptions:{...config.compilerOptions,noEmit:false,declaration:true,emitDeclarationOnly:true,outDir:"emitted",rootDir:"."},files:[stem+".vibe"]};put(join(candidate,"tsconfig.emit.json"),JSON.stringify(emitConfig))
  const emitted=spawnSync(compiler,["-p",join(candidate,"tsconfig.emit.json"),"--singleThreaded","--pretty","false"],{encoding:"utf8",timeout:120000,env:process.env});assert.equal(emitted.status,0,JSON.stringify({key,mode,stdout:emitted.stdout,stderr:emitted.stderr,error:emitted.error?.message}))
  const outputs=[];const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory())walk(f);else if(f.endsWith(".d.ts"))outputs.push(f)}};walk(join(candidate,"emitted"));assert.equal(outputs.length,1,JSON.stringify(outputs))
  const bytes=readFileSync(outputs[0]);writeFileSync(join(candidate,stem+".d.vibe.ts"),bytes);sidecarOrigin={code:emitted.status,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length};nativeControls.push({code:emitted.status,mode:"declaration"})
 }else if(native)rmSync(join(candidate,stem+".d.vibe.ts"),{force:true})
 const program=ts.createProgram([join(candidate,"main.ts")],options),sf=program.getSourceFile(join(candidate,"main.ts")),checker=program.getTypeChecker()
 const metadataErrors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.code)
 if(native&&!signature)assert.ok(metadataErrors.every(c=>c===2307||c===7016),JSON.stringify(metadataErrors));else assert.deepEqual(metadataErrors,[])
 const tree=()=>{const r={};const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(dir,e.name);if(e.isSymbolicLink())r[f.slice(root.length+1)]="link:"+readlinkSync(f);else if(e.isDirectory())walk(f);else r[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return r}
 const before=tree(),direct=plainEdits(ts,checker,sf,{flipped:modern}),marked=applyPlainEdits(sf.text,direct.edits),writes={}
 const integrated=markPlainFunctions(ts,candidate,["main.ts"],["tsconfig.json"],{flipped:modern,write:(file,text)=>{writes[file]=text}})
 const actual=writes["main.ts"]??sf.text
 assert.equal(actual,marked,"direct and configured preservation decisions differ")
 const expected=modern||effect?sf.text:applyPlainEdits(sf.text,[{pos:sf.text.indexOf(") =>")+1,text:": infer _"}])
 // Unknown native value signatures may be conservatively left unchanged.
 const ok=actual===expected||(native&&!signature&&!effect&&actual===sf.text)
 const knownGap=!ok&&key==="vibe-effect"&&metadataErrors.length>0&&actual.includes(": infer _")&&direct.edits.every(e=>e.text===": infer _")&&direct.left.length===0
 console.log(JSON.stringify({key,mode,ok,knownGap,unchanged:JSON.stringify(before)===JSON.stringify(tree()),controlErrors,metadataErrors,nativeControls,sidecarOrigin,marked:actual!==sf.text,direct,integrated,source:sf.text,actual,originalReturn:originalChecker.typeToString(originalType)}))
} finally {rmSync(root,{recursive:true,force:true})}
