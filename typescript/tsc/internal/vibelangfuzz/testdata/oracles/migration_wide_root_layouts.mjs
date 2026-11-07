import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { dirname,join,relative } from "node:path"
import { compareDeclarations,recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-wide-root-transitive-declaration.json",import.meta.url),"utf8"))
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/wide-root-layouts-"))
const put=(f,t)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,t)}
// Keys: where the imported file sits and whether the root lists it.
// transitive-*: rootDir above the package, include ["src"], and src/main.ts
// imports a package file outside include (the T3code server schema).
// included: the same layout with the schema directory listed in include.
// local-root: rootDir "." with the same transitive import.
// native-transitive: the transitive layout emitted by the native compiler, as
// the T3code server is.
// changed-type / missing-file: the negative guards must still fire under the
// wide root; missing-file removes the schema's declaration, its emitted copy
// and its source before the record, so no shipped copy can stand in.
try {
 const native=key==="native-transitive",generated=key!=="transitive-ordinary",deep=mode&1,valueImport=mode&2,crlf=mode&4,spaced=mode&8
 const schemaDir=spaced?"schema δ":"schema",schemaBase=generated?"expo.graphql":"generated"
 const normal=t=>crlf?t.replaceAll("\n","\r\n"):t
 const local=key==="local-root"
 const pkgRel=deep?"apps/server":"server"
 const rootDir=local?".":deep?"../..":".."
 function emit(side) {
  const ws=join(root,side),pkg=join(ws,pkgRel)
  const schemaFile=join(pkg,schemaDir,schemaBase+".ts")
  let schema=fixture.schema
  if(side==="after"&&key==="changed-type")schema=schema.replace('"stopped"','"stopped" | "failed"')
  if(valueImport)schema+='export const ready: Status = "ready";\n'
  put(schemaFile,normal(schema))
  let spec=relative(join(pkg,"src"),schemaFile).replaceAll("\\","/");if(!spec.startsWith("."))spec="./"+spec
  let main=fixture.main.replace("../schema/expo.graphql.ts",spec)
  if(valueImport)main=main.replace("import type { Status }","import { ready, type Status }")+"export const first = ready;\n"
  put(join(pkg,"src/main.ts"),normal(main))
  const include=key==="included"?["src",relative(pkg,dirname(schemaFile)).replaceAll("\\","/")]:["src"]
  const config={compilerOptions:{target:"ESNext",module:"ESNext",moduleResolution:"Bundler",rootDir,strict:true,types:[],skipLibCheck:true,allowImportingTsExtensions:true,declaration:true,emitDeclarationOnly:true,outDir:"dist"},include}
  put(join(pkg,"tsconfig.json"),JSON.stringify(config))
  const parsed=ts.parseJsonConfigFileContent(config,ts.sys,pkg)
  const program=ts.createProgram(parsed.fileNames,parsed.options)
  const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.code)
  assert.deepEqual(errors,[],JSON.stringify({key,mode,side,errors}))
  if(native){
   const compiler=join(process.cwd(),"packages/compiler/native/vibelang")
   const run=spawnSync(compiler,["-p",join(pkg,"tsconfig.json"),"--singleThreaded","--pretty","false"],{encoding:"utf8",timeout:120000})
   assert.equal(run.status,0,JSON.stringify({key,mode,side,stdout:run.stdout,stderr:run.stderr,error:run.error?.message}))
  }else{const emitted=program.emit();assert.equal(emitted.emitSkipped,false)}
  const out=join(pkg,"dist"),files=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const f=join(d,e.name);if(e.isDirectory())walk(f);else files.push(relative(out,f).replaceAll("\\","/"))}};walk(out)
  const entry=files.find(f=>f.endsWith("src/main.d.ts"));assert.ok(entry,JSON.stringify(files))
  const manifest={name:"server",type:"module",private:true,exports:{".":{types:"./dist/"+entry,default:"./dist/"+entry.replace(/\.d\.ts$/,".js")}}}
  put(join(pkg,"package.json"),JSON.stringify(manifest))
  const snapshot=join(root,"snapshot-"+side);cpSync(out,snapshot,{recursive:true})
  if(side==="after"&&key==="missing-file"){const lost=files.find(f=>f.endsWith(schemaBase+".d.ts"));rmSync(join(snapshot,lost));rmSync(join(out,lost));rmSync(schemaFile)}
  recordDeclarationSurface(ts,snapshot,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],manifest)
  const surface=JSON.parse(readFileSync(join(snapshot,"public-surface.json"),"utf8"))
  return {snapshot,files,layouts:surface.apiMetadata?.layouts??null}
 }
 const before=emit("before"),after=emit("after")
 const tree=()=>{const r={};const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(d,e.name);if(e.isDirectory())walk(f);else r[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return r}
 const original=tree()
 const result=compareDeclarations(ts,before.snapshot,after.snapshot,{canonical:true,includePrivate:true})
 const expectedComplete=key!=="missing-file",expectedIdentical=!["missing-file","changed-type"].includes(key)
 const ok=result.comparisonComplete===expectedComplete&&result.identical===expectedIdentical
 // The gap the finding names: an unchanged package compared with itself is unavailable.
 const knownGap=!ok&&key.startsWith("transitive")&&result.comparisonComplete===false
 console.log(JSON.stringify({key,mode,ok,knownGap,unchanged:JSON.stringify(original)===JSON.stringify(tree()),expectedComplete,expectedIdentical,complete:result.comparisonComplete,identical:result.identical,emitted:before.files,layouts:before.layouts,reason:result.incompleteReason??null,names:result.nameDifferences,types:result.typeDifferences?.slice(0,2),env:(result.environmentDiagnostics??[]).slice(0,2)}))
} finally {rmSync(root,{recursive:true,force:true})}
