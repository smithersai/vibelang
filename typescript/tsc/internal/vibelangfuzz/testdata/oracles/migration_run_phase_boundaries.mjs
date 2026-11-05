import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const root=process.cwd(),require=createRequire(join(root,"docs/tools/package.json")),ts=require("typescript")
const {runPhaseChanges,blocking}=await import(pathToFileURL(join(root,".smithers/flows/migrate/lib/run-phase.mjs")))
const {original,native,ast,expectedBlocking,stock}=JSON.parse(readFileSync(0,"utf8"))
let stockDiagnostics
if(stock){
 const file=join(root,"experiments","__run_phase_boundary_control.ts")
 const options={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:[]}
 const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host),read=host.readFile.bind(host),exists=host.fileExists.bind(host)
 host.getSourceFile=(name,...args)=>name===file?ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true):get(name,...args)
 host.readFile=name=>name===file?original:read(name)
 host.fileExists=name=>name===file||exists(name)
 stockDiagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options,host)).map(d=>d.code)
 if(stockDiagnostics.length)throw Error("invalid stock original: "+stockDiagnostics.join(","))
}
const changes=runPhaseChanges({ts,original,originalPath:"main.ts",vibe:ast,vibeText:native})
const blocked=changes.filter(blocking)
const ok=expectedBlocking?blocked.length>0:changes.length===0
console.log(JSON.stringify({ok,expectedBlocking,stockVersion:ts.version,stockDiagnostics,changes,original,native}))
