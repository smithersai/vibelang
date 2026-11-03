import { Context } from "effect"
type Shape = { n: number }
export const Flags = Context.Reference<Shape>("coverage/Annotated", {defaultValue: (() => ({n:1})) satisfies () => Shape})

