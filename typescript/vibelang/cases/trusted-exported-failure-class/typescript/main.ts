import { Effect } from "effect"
import { read } from "./foreign.ts"
export function main(): Effect.Effect<number, Error> { return Effect.sync(() => read(0)) }
