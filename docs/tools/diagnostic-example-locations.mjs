// Replay selected published locations without changing the complete Appendix runner.
import {readFileSync,mkdirSync} from "node:fs"
import {join} from "node:path"
import {resolveExamples,probeExamples} from "./diagnostic-examples.mjs"
import {loadIdentity,repository} from "./diagnostic-identity.mjs"
const codes=new Set(process.argv.slice(2))
if(!codes.size || [...codes].some(code=>!/^EK[0-9]{4}$/.test(code)))throw Error("supply one or more diagnostic codes")
const appendix=loadIdentity(repository).appendix
const fixtures=JSON.parse(readFileSync(join(repository,"typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"),"utf8"))
const examples=resolveExamples(fixtures,appendix).filter(example=>codes.has(example.code))
for(const code of codes)if(!examples.some(example=>example.code===code))throw Error(code+": no executable published example")
mkdirSync(join(repository,".cache"),{recursive:true})
const result=probeExamples(examples,appendix,process.env.VIBELANG_COMPILER??join(repository,"packages/compiler/native/vibelang"))
for(const receipt of result.receipts)console.log(JSON.stringify(receipt))
process.exitCode=result.findings.length?1:0
