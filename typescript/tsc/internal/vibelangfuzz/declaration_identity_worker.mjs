// The same strict API gate for every input. Only validated dependency
// diagnostics, file diagnostics keyed by their whole checked environment and
// bounded parsed dependencies persist; programs and type/doc probes do not.
import { createRequire } from "node:module"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
const [gate,api]=process.argv.slice(2)
const {compareApiIdentity,formatResult}=await import(pathToFileURL(gate))
const ts=createRequire(import.meta.url)(api)
const {createDependencyDocuments}=await import(new URL("./api-identity-diagnostics-cache.mjs",pathToFileURL(gate)))
const {stockAPIPreflight}=await import(new URL("./declaration_stock_api_preflight.mjs",import.meta.url))
const dependencyDocuments=createDependencyDocuments(ts)
class DiagnosticCache extends Map {
 lookups=0
 hits=0
 get(key){this.lookups++;const value=super.get(key);if(value!==undefined)this.hits++;return value}
}
// fileDiagnosticKeys hashes a file's compiler options, every file that changes
// the global scope or declares a module, and the module graph the file reaches
// (paths, module formats, texts and resolutions). An equal key in a later
// comparison names the same diagnostics, so they are not checked again.
class FileDiagnostics extends Map {
 lookups=0
 hits=0
 has(key){this.lookups++;return super.has(key)}
 get(key){const value=super.get(key);if(value!==undefined)this.hits++;return value}
 set(key,value){if(!super.has(key)&&this.size>=16384)this.delete(this.keys().next().value);return super.set(key,value)}
}
const dependencyDiagnosticsCache=new DiagnosticCache()
const fileDiagnostics=new FileDiagnostics()
const stats=()=>({lookups:dependencyDiagnosticsCache.lookups,hits:dependencyDiagnosticsCache.hits,entries:dependencyDiagnosticsCache.size,
 files:{lookups:fileDiagnostics.lookups,hits:fileDiagnostics.hits,entries:fileDiagnostics.size},
 documents:dependencyDocuments.stats(),rss:process.memoryUsage().rss})
const input=createInterface({input:process.stdin,crlfDelay:Infinity})
for await (const line of input){
 let request
 try{
  request=JSON.parse(line)
  const started=process.cpuUsage(), wall=performance.now()
  const measured=()=>({...stats(),cpu:process.cpuUsage(started),wallMs:performance.now()-wall})
  if(request.kind==="preflight"){
   const records=stockAPIPreflight(ts,request.root,dependencyDocuments.read)
   process.stdout.write(JSON.stringify({id:request.id,records,stats:measured()})+"\n")
   continue
  }
  const result=compareApiIdentity(ts,request.baseline,request.current,{dependencyDiagnosticsCache,dependencyDocuments,lazyAmbientDocumentation:true,
   identityReuse:{files:fileDiagnostics,nominal:new Map()}})
  process.stdout.write(JSON.stringify(result.comparisonComplete===false
   ?{id:request.id,error:formatResult(result),stats:measured()}
   :{id:request.id,diff:result.identical?"":formatResult(result),stats:measured()})+"\n")
 }catch(error){
  process.stdout.write(JSON.stringify({id:request?.id,error:String(error?.stack??error),stats:stats()})+"\n")
 }
}
