import { Effect } from "effect"
function plain(){throw "bad"}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){let thrown:unknown;try{plain()}catch(e){thrown=e};const result=yield* Effect.exit(Effect.fail("bad"));return [thrown,result._tag,result._tag==="Failure"&&result.cause.reasons.map(r=>r._tag)]})}
