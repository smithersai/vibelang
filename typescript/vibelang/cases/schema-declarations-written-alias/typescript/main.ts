import { Effect, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
/** Value documentation. */
export const Message = Schema.Struct({ id: Schema.String })
/** Type documentation. */
export type Message = typeof Message.Type
/** Early type documentation. */
export type Early = typeof Early.Type
/** Early value documentation. */
export const Early = Schema.Literals(["a", "b"])
export const exact: Equal<Message, { readonly id: string }> = true
export const early: Equal<Early, "a" | "b"> = true
export function main() { return Effect.succeed([Schema.is(Message)({ id: "x" }), Schema.is(Early)("a")]) }
