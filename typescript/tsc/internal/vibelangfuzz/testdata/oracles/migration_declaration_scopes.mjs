import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { foreignChanges } from "../../../../../../.smithers/flows/migrate/lib/touched.mjs"

const [key,rawMode]=process.argv.slice(2), mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-generated-platform-declaration-scope.json",import.meta.url),"utf8"))
const dir=mode&1?"packages/nested/space δ":"src"
const ext=mode&2?".vibex":".vibe", body=mode&4?"worker":"platform"
const stem=dir+"/"+(mode&8?"moduleΔ":"probe")
const path=stem+ext, source=stem+(mode&2?".tsx":".ts")
const declaration=path+"."+body+".d.ts", sidecar=stem+(mode&2?".d.vibex.ts":".d.vibe.ts")
const batch={files:[{planned:source,path,migrated:true}],codemod:{platform:{splits:[{file:source,platform:null,module:body}]}}}
let changed=[{status:"A",path:declaration}], expected=[]
if(key==="unrecorded-body") { delete batch.codemod.platform;expected=changed }
if(key==="wrong-body") { batch.codemod.platform.splits[0].module=body+"Other";expected=changed }
if(key==="plain-sidecar") changed=[{status:"A",path:sidecar}]
if(key==="foreign-body") { changed=[{status:"A",path:dir+"/other"+ext+"."+body+".d.ts"}];expected=changed }
if(key==="unmigrated-body") { batch.files=[{planned:source,path:source,migrated:false}];expected=changed }
if(key==="renamed-foreign") { changed=[{status:"R",from:dir+"/other.d.ts",path:sidecar}];expected=changed }
if(key==="recorded-output") batch.codemod={packingFiles:[declaration]}
if(key==="protected-test") { changed=[{status:"M",path:stem+".test.ts"}];expected=changed }
assert.ok(fixture.source.includes("module platform"))
const before=JSON.stringify({fixture,batch,changed}), actual=foreignChanges(changed,batch)
const unchanged=before===JSON.stringify({fixture,batch,changed})
console.log(JSON.stringify({ok:JSON.stringify(actual)===JSON.stringify(expected),unchanged,key,mode,changed,expected,actual}))
