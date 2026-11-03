/** @throws {never} */
export function holes(log: string[], badClose = false, present = false): Generator<number | undefined> {
  return (function* () {
    try { log.push("start"); yield present ? 4 : undefined; log.push("second"); yield 2 }
    finally { log.push("closed"); if (badClose) throw "close" }
  })()
}

/** @throws {never} */
export function throwValue(value: string): never { throw value }

import { Effect } from "effect"
export function observe<A, E, R>(program: Effect.Effect<A, E, R>) {
  return Effect.map(Effect.exit(program), result => result._tag === "Success"
    ? ["Success", result.value]
    : ["Failure", result.cause.reasons.map(reason => [reason._tag, reason._tag === "Die" ? reason.defect : reason._tag === "Fail" ? reason.error : "interrupted"])])
}
