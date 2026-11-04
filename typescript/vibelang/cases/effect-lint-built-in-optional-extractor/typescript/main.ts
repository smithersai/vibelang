import {Option,Effect} from "effect"
export function main(): Effect.Effect<number, never, never> { return Effect.gen(function* () { return Option.isNone(Option.none())?1:0 }) }
