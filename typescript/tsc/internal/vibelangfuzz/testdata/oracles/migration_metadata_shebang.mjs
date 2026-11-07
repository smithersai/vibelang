import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join,resolve } from "node:path"
import { splitBatchPlatform } from "../../../../../../.smithers/flows/migrate/lib/platform.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-import-meta-companion-shebang.json",import.meta.url),"utf8"))
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/metadata-shebang-"))
try {
 let source=fixture.source
 if(key==="filename")source=source.replace('import.meta.dirname + "/input"',"import.meta.filename")
 if(key==="resolve")source=source.replace('import.meta.dirname + "/input"','import.meta.resolve("./input")')
 if(key==="env")source=source.replace('import.meta.dirname + "/input"','import.meta.env.INPUT')
 if(key==="no-meta-control")source=source.replace('import.meta.dirname + "/input"','"./input"')
 if(key==="no-shebang-control")source=source.replace(/^#!.*\n/,"")
 if(mode&1)source=source.replaceAll("* as FS","* as Files").replaceAll("FS.","Files.")
 if(mode&4)source=source.replace('import * as','/** A command entry. */\n\nimport * as')
 if(mode&8)source=source.replace("#!/usr/bin/env node","#!/usr/bin/env -S node --no-warnings")
 if(mode&2)source=source.replaceAll("\n","\r\n")
 assert.deepEqual(ts.createSourceFile("run.ts",source,ts.ScriptTarget.Latest,true).parseDiagnostics,[])
 writeFileSync(join(root,"package.json"),'{"name":"metadata-shebang-fixture","private":true,"type":"module"}')
 writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true},files:["run.ts"]}))
 symlinkSync(resolve(process.env.EFFECT_NODE_MODULES??"experiments/node_modules"),join(root,"node_modules"),"dir")
 writeFileSync(join(root,"run.ts"),source)
 const result=splitBatchPlatform(root,["run.ts"],ts,{moduleBodies:true})
 assert.equal(result.refused.length,0,JSON.stringify({key,mode,result}));assert.equal(result.splits.length,1,JSON.stringify({key,mode,result}))
 const split=result.splits[0],module=readFileSync(join(root,"run.ts"),"utf8")
 const platform=split.platform?readFileSync(join(root,split.platform),"utf8"):""
 const shebang=source.match(/^#![^\r\n]*/)?.[0]
 const entryOK=shebang?module.startsWith(shebang)&&module.split("#!").length===2:!module.includes("#!")
 const codes=ts.createSourceFile("run.platform.ts",platform,ts.ScriptTarget.Latest,true).parseDiagnostics.map(d=>d.code)
 const ok=entryOK&&!platform.includes("#!")&&codes.length===0
 const knownGap=!ok&&Boolean(shebang)&&platform.includes(shebang)&&codes.includes(18026)&&codes.every(code=>[18026,1005].includes(code))&&!key.endsWith("-control")
 const gapKey="shebang:"+key+":"+(mode&4?"documented-"+(mode&2?"crlf":"lf"):"bare")
 const files=readdirSync(root).filter(name=>name!=="node_modules").sort()
 assert.deepEqual(files,split.platform?["package.json","run.platform.ts","run.ts","tsconfig.json"]:["package.json","run.ts","tsconfig.json"])
 console.log(JSON.stringify({key,mode,gapKey,ok,knownGap,entryOK,codes,module,platform}))
} finally {rmSync(root,{recursive:true,force:true})}
