import { Effect } from "effect"
export const arrow = () => Effect.gen(function* () { return arrow === arrow })
export const named = function own() { return Effect.gen(function* () { return own === named }) }
export const own = function inner() { return Effect.gen(function* () { return inner === inner }) }
export const kind = () => Effect.gen(function* () { return typeof kind })
export const annotated = (): Effect.Effect<boolean> => Effect.gen(function* () { return annotated === annotated })
export function declaration() { return Effect.gen(function* () { return declaration === declaration }) }
