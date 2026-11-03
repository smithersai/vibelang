// run-seconds: 180
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"bridged",["ok",""],async(fn,E,s)=>{const e=await E.runPromiseExit(fn(s));return e._tag==="Success"?exitView(e):{_tag:"Failure",reasons:e.cause.reasons.map(r=>({_tag:r._tag,name:r.error?.name,message:r.error?.message}))}})
console.log("declaration-output-foreign-bridge")
