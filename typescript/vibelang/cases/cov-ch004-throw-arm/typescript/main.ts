import { Effect } from "effect"
import { plainThrown } from "./plain-native.js"
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){const thrown=yield* plainThrown;const result=yield* Effect.exit(Effect.fail("bad"));return [thrown,result._tag,result._tag==="Failure"&&result.cause.reasons.map(r=>r._tag)]})}
