import { Schema } from "effect"

export const Box = Schema.Struct({ value: Schema.String })
export type Box = Schema.Schema.Type<typeof Box>
export const local = (input: { readonly n: number }) => input.n
