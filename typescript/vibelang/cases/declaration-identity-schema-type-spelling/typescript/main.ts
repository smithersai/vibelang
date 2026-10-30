import { Schema } from "effect"

export const Token = Schema.Struct({ id: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>
export const Session = Schema.Struct({ id: Schema.String })
export interface Session extends Schema.Schema.Type<typeof Session> {}
