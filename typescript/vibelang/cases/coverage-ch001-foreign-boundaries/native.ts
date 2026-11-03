import { Effect } from "effect"
import { legacy } from "./foreign.js"
export const main = () => Effect.gen(function* () { return yield* Effect.try(() => legacy(1,2,3)) })
