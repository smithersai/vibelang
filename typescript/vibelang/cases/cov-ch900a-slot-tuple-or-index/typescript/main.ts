import { Effect } from "effect"
function witness(x: unknown) {
 const tuple: Effect.Effect<number, never, [0]> = x as Effect.Effect<number, never, [0]>
 // @ts-expect-error: completed Effect value has no numeric index
 const indexed = (x as Effect.Effect<number>)[0]
}
export function main() { return Effect.gen(function* () { return 1 }) }
