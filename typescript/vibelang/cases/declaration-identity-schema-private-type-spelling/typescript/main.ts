import { Schema } from "effect"
const Meta = Schema.Struct({ id: Schema.String })
type Meta = Schema.Schema.Type<typeof Meta>
export interface Event { readonly meta?: Meta }
export const Token = Schema.Struct({ id: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>


// A private interface and an indirect reference are printed too.
const Detail = Schema.Struct({ value: Schema.Number })
interface Detail extends Schema.Schema.Type<typeof Detail> {}
type Envelope = { readonly detail: Detail }
export interface Container { readonly envelope: Envelope }
