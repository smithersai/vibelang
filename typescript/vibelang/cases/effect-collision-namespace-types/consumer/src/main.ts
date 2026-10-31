// TypeScript code that reads Effect.M types through the declarations.
import * as A from "effect/Array"
import { counts, first, pair, type Pair } from "../../out/main.js"

const more: Pair = [pair[0], ...A.tailNonEmpty(pair)]
export const lines = [A.headNonEmpty(first), counts.a, more.length, more.join("")]
