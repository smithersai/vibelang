import {Effect,Exit} from "effect"
function foreign():never {throw "foreign"}
const awaited=await Promise.resolve(3)
let caught=""
try{foreign()}catch{caught="foreign"}
async function rejected(){throw new Error("async")}
const cold=Effect.fail("typed")
export function main(){return Effect.gen(function*(){const rejectedExit=yield* Effect.exit(Effect.tryPromise(()=>rejected()));const failedExit=yield* Effect.exit(cold);return [awaited,caught,Exit.isFailure(rejectedExit),Exit.isFailure(failedExit)]})}
