// Capture the original identity allocation; never refresh it from current code.
import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {execFileSync} from "node:child_process"
import {readFileSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {identityHash} from "../docs/tools/diagnostic-identity-renames.mjs"
import {goTokens} from "../docs/tools/diagnostic-identity.mjs"

const root=fileURLToPath(new URL("../",import.meta.url))
const proofPath=new URL("../docs/design/diagnostic-identity-renames.json",import.meta.url)
const output=new URL("../docs/design/diagnostic-identity-allocation.json",import.meta.url)
const mode=process.argv[2]??"--check"
assert.ok(["--write","--check"].includes(mode),"use --write or --check")
const proof=JSON.parse(readFileSync(proofPath,"utf8"))
assert.match(proof.allocation,/^[a-f0-9]{40}$/)
const jj=args=>execFileSync("jj",["--ignore-working-copy","--color=never",...args],
 {cwd:root,encoding:"utf8",maxBuffer:16*1024*1024})
const source=(rev,path)=>jj(["file","show","-r",rev,"--",path])
const digest=text=>createHash("sha256").update(text).digest("hex")
const compact=text=>{
 const values=goTokens(text).map(token=>token.value)
 const result=values.join(" ")
 assert.deepEqual(goTokens(result).map(token=>token.value),values,"token capture must round-trip")
 return result
}
function segments(patch) {
 const result=[];let before=[],after=[],active=false
 const flush=()=>{if(active)result.push({before:compact(before.join("\n")),after:compact(after.join("\n"))});before=[];after=[]}
 for(const line of patch.split("\n")) {
  if(line.startsWith("@@ ")){flush();active=true}
  else if(active && line.startsWith(" ")){before.push(line.slice(1));after.push(line.slice(1))}
  else if(active && line.startsWith("-"))before.push(line.slice(1))
  else if(active && line.startsWith("+"))after.push(line.slice(1))
 }
 flush();return result
}
const files=proof.files.map(record=>{
 const base=record.base??proof.base
 assert.match(record.path,/^typescript\/tsc\/internal\/(?:vibelang|vibelangmapper)\/[^/]+\.go$/)
 const before=source(base,record.path),after=source(proof.allocation,record.path)
 assert.equal(identityHash(before,record.path),record.normalizedSha256,record.path+": original checkpoint mismatch")
 assert.equal(identityHash(after,record.path),record.normalizedSha256,record.path+": allocation changed the checker")
 let captured=segments(jj(["diff","--git","--context=8","--from",base,"--to",proof.allocation,"--",record.path]))
 if(captured.length===0 || captured.some(part=>identityHash(part.before,record.path)!==identityHash(part.after,record.path))) {
  captured=[{before:compact(before),after:compact(after)}]
 }
 assert.ok(captured.every(part=>identityHash(part.before,record.path)===identityHash(part.after,record.path)))
 return {path:record.path,base,normalizedSha256:record.normalizedSha256,
  beforeSourceSha256:digest(before),afterSourceSha256:digest(after),segments:captured}
})
const text=JSON.stringify({generatedBy:"scripts/capture-diagnostic-identity-allocation.mjs",
 allocation:proof.allocation,files},null,2)+"\n"
if(mode==="--write") {
 writeFileSync(output,text)
 proof.allocationSnapshotSha256=digest(text)
 writeFileSync(proofPath,JSON.stringify(proof,null,2)+"\n")
} else {
 assert.equal(readFileSync(output,"utf8"),text,"allocation capture is stale")
 assert.equal(proof.allocationSnapshotSha256,digest(text),"allocation capture digest is stale")
}
console.log("identity allocation capture verified: "+files.length+" files, "+Buffer.byteLength(text)+" bytes")
