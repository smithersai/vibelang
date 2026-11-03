import { Effect } from "effect"
import { legacy } from "./foreign.js"
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () { return yield* Effect.try(() => legacy()) }) }
