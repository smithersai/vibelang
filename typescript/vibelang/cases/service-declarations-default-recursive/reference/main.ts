import { Context, Effect } from "effect"
type Shape = { next?: Shape }
const Reference = Context.Reference<Shape>("coverage/Reference", { defaultValue: (): Shape => ({ next: undefined }) })
export const value: Context.Service.Shape<typeof Reference> = { next: { next: undefined } }
const exact: Shape = value
export function main() { return Effect.gen(function* () { return [(yield* Reference).next === undefined, exact.next?.next === undefined] }) }
