import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,rmSync,symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join,posix } from "node:path"
import { tmpdir } from "node:os"
import { recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
import { makeConfig,paths,record } from "../../../../../../.smithers/flows/migrate/lib/steps.mjs"
import { verifyTestDiff } from "../../../../../../.smithers/flows/migrate/lib/test-diff.mjs"
import * as Jj from "../../../../../../.smithers/flows/migrate/lib/jj.mjs"
import { must,writeJson,slug } from "../../../../../../.smithers/flows/migrate/lib/util.mjs"
const runtimeRequire=createRequire(join(process.cwd(),"packages/runtime/package.json"))
const compilerRequire=createRequire(join(process.cwd(),"packages/compiler/package.json"))
const ts=runtimeRequire("typescript"),prettier=compilerRequire("prettier")
const prettierManifestPath=compilerRequire.resolve("prettier/package.json")
const prettierManifest=JSON.parse(readFileSync(prettierManifestPath,"utf8"))
const prettierBin=join(dirname(prettierManifestPath),typeof prettierManifest.bin==="string"?prettierManifest.bin:prettierManifest.bin.prettier)
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const corpus=JSON.parse(readFileSync(new URL("../corpus/t3code-record-protected-import-layout.json",import.meta.url),"utf8"))
const outer=mkdtempSync(join(tmpdir(),"protected-record-layout-")),target=join(outer,"repo"),run=join(outer,"run")
try {
 mkdirSync(join(target,"node_modules/.bin"),{recursive:true})
 symlinkSync(dirname(runtimeRequire.resolve("typescript/package.json")),join(target,"node_modules/typescript"),"dir")
 symlinkSync(prettierBin,join(target,"node_modules/.bin/prettier"))
 const width=mode&8?60:80,singleQuote=Boolean(mode&1),crlf=key==="formatted-crlf"||Boolean(mode&2)
 const style={parser:"typescript",printWidth:width,singleQuote,semi:true,endOfLine:crlf?"crlf":"lf"}
 let file=key==="fixture-long"?"fixtures/sample.ts":key==="spec-long"?"sample.spec.mts":"sample.test.ts"
 if(mode&4)file="test/space δ/"+file
 mkdirSync(dirname(join(target,file)),{recursive:true})
 const relative=(name)=>{const p=posix.relative(posix.dirname(file),name);return p.startsWith(".")?p:"./"+p}
 const originalSpecifier=relative("HostProcess.ts"),nativeSpecifier=relative("HostProcess.vibe")
 let source=corpus.test
 if(key==="short")source='import * as HostProcess from "./HostProcess.ts";\nimport { read } from "./nodeRuntime.vibe";\nvoid [HostProcess, read];\n'
 if(key==="comment-long")source="// Preserve the test's source layout.\n"+source
 source=source.replaceAll("./HostProcess.ts",originalSpecifier).replaceAll("./nodeRuntime.vibe",relative("nodeRuntime.vibe"))
 source+="const assertion = 1;\nvoid assertion;\n"
 if(singleQuote)source=source.replaceAll('"',"'")
 if(crlf)source=source.replaceAll("\n","\r\n")
 if(key==="formatted"||key==="formatted-crlf")source=await prettier.format(source,style)
 let candidate=source.replace(originalSpecifier,nativeSpecifier)
 if(key==="assertion-loss")candidate=candidate.replace("assertion = 1","assertion = 2")
 writeJson(join(target,"package.json"),{name:"record-layout-fixture",version:"1.0.0",files:["HostProcess.ts","HostProcess.vibe"],types:"./HostProcess.d.ts",scripts:{format:"prettier --check ."},devDependencies:{prettier:prettierManifest.version}})
 const {parser,...configStyle}=style
 writeJson(join(target,".prettierrc.json"),configStyle)
 writeJson(join(target,"tsconfig.json"),{compilerOptions:{rootDir:"."},include:["*.vibe"]})
 writeFileSync(join(target,".gitignore"),"node_modules/\n")
 writeFileSync(join(target,"HostProcess.ts"),corpus.module)
 writeFileSync(join(target,file),source)
 await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:target})
 await Jj.commit(target,"original")
 renameSync(join(target,"HostProcess.ts"),join(target,"HostProcess.vibe"))
 writeFileSync(join(target,file),candidate)
 // Deterministic emit and test fixtures isolate formatter selection.
 // Prettier, jj, the scope proof and record itself are real.
 writeFileSync(join(target,"node_modules/.bin/vibelang-format"),'#!/usr/bin/env node\nprocess.exit(0)\n',{mode:0o755})
 writeFileSync(join(target,"node_modules/.bin/vibelang"),'#!/usr/bin/env node\nconst fs=require("node:fs"),p=require("node:path");const i=process.argv.indexOf("--outDir");if(i>=0){const out=process.argv[i+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,"HostProcess.d.ts"),'+JSON.stringify(corpus.declaration)+');}\n',{mode:0o755})
 const p=paths(run)
 writeJson(p.config,makeConfig({target,test:"true",vibelangVersion:"0.0.11"}))
 writeJson(p.plan,{batches:[{files:["HostProcess.ts"]}]})
 writeJson(p.codemod("01"),{renames:[{from:"HostProcess.ts",to:"HostProcess.vibe"}],fix:{refused:[],totals:{}}})
 writeJson(p.inventory,{files:[{path:"HostProcess.ts",tokens:99}]})
 writeJson(join(p.baseline,"tests.json"),{code:0,tests:{},total:0,passed:0,failed:[],skipped:0})
 writeJson(join(p.baseline,"compile-"+slug(".")+".json"),[])
 writeJson(join(p.baseline,"upstream-packs.json"),{packages:{".":{files:["HostProcess.ts","package.json"]}}})
 writeJson(join(p.baseline,"declaration-oracle.json"),{".":{compiler:"deterministic-fixture",files:[],missing:[],extra:[],changed:[]}})
 const baseline=join(p.baseline,"dts",slug("."));mkdirSync(baseline,{recursive:true})
 writeFileSync(join(baseline,"HostProcess.d.ts"),corpus.declaration)
 recordDeclarationSurface(ts,baseline,target,[{tsconfig:"tsconfig.json",prefix:"."}])
 const before={"HostProcess.ts":corpus.module,[file]:source}
 const after={"HostProcess.vibe":corpus.module,[file]:candidate}
 const precheck=verifyTestDiff({ts,before,after,renames:[{from:"HostProcess.ts",to:"HostProcess.vibe"}],scratch:join(outer,"precheck")})
 writeJson(p.verify("01"),{ok:true,checks:{packs:true}})
 const base=await Jj.commitId(target,"@-")
 let recorded=false,reason=""
 try {const result=await record({run,batch:"01"});recorded=Boolean(result.commit)}catch(error){reason=error.message}
 const actual=readFileSync(join(target,file),"utf8")
 const postcheck=verifyTestDiff({ts,before,after:{"HostProcess.vibe":corpus.module,[file]:actual},renames:[{from:"HostProcess.ts",to:"HostProcess.vibe"}],scratch:join(outer,"postcheck")})
 console.log(JSON.stringify({key,mode,file,width,precheck:precheck.ok,postcheck:postcheck.ok,recorded,reason,exactLayout:actual===candidate,changed:actual!==candidate,baseUnchanged:await Jj.commitId(target,"@-")===base,formatter:"prettier@"+prettierManifest.version,emitter:"deterministic-fixture",original:source,candidate,actual}))
} finally {rmSync(outer,{recursive:true,force:true})}
