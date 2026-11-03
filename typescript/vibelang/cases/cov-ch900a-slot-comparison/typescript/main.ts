import { Effect } from "effect"
function witness(x: unknown) {
 // @ts-expect-error: native comparison checking remains
 const result = (x as Effect.Effect<number>) < 3
}
export function main() { return Effect.gen(function* () { return 1 }) }
