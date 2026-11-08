import { Effect } from "effect"
import { Plain, Throwing, sample } from "./foreign.js"
const self: typeof Plain = Plain
const tagged: typeof Throwing = Throwing
const identity = <T>(value: T): T => value
const inferred = identity(Plain)
const statics = Object.assign({}, { make: Plain })
export function probe(subject: unknown): readonly boolean[] {
 return [subject instanceof Plain, subject instanceof Plain, self === Plain, tagged === Throwing, inferred === Plain, statics.make === Plain]
}
export function main(): Effect.Effect<readonly boolean[]> { return Effect.succeed(probe(sample)) }
