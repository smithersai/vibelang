// The same strict API gate for every input. Only validated dependency
// diagnostics and bounded parsed dependencies persist; programs, owned diagnostics
// and type/doc probes do not.
import { createRequire } from "node:module"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
const [gate,api]=process.argv.slice(2)
const {compareApiIdentity,formatResult}=await import(pathToFileURL(gate))
const ts=createRequire(import.meta.url)(api)
const {createDependencyDocuments}=await import(new URL("./api-identity-diagnostics-cache.mjs",pathToFileURL(gate)))
const dependencyDocuments=createDependencyDocuments(ts)
class DiagnosticCache extends Map {
 lookups=0
 hits=0
 get(key){this.lookups++;const value=super.get(key);if(value!==undefined)this.hits++;return value}
}
const dependencyDiagnosticsCache=new DiagnosticCache()
const stats=()=>({lookups:dependencyDiagnosticsCache.lookups,hits:dependencyDiagnosticsCache.hits,entries:dependencyDiagnosticsCache.size,documents:dependencyDocuments.stats(),rss:process.memoryUsage().rss})
const input=createInterface({input:process.stdin,crlfDelay:Infinity})
for await (const line of input){
 let request
 try{
  request=JSON.parse(line)
  const started=process.cpuUsage(), wall=performance.now()
  const result=compareApiIdentity(ts,request.baseline,request.current,{dependencyDiagnosticsCache,dependencyDocuments,lazyAmbientDocumentation:true})
  process.stdout.write(JSON.stringify(result.comparisonComplete===false
   ?{id:request.id,error:formatResult(result),stats:{...stats(),cpu:process.cpuUsage(started),wallMs:performance.now()-wall}}
   :{id:request.id,diff:result.identical?"":formatResult(result),stats:{...stats(),cpu:process.cpuUsage(started),wallMs:performance.now()-wall}})+"\n")
 }catch(error){
  process.stdout.write(JSON.stringify({id:request?.id,error:String(error?.stack??error),stats:stats()})+"\n")
 }
}
