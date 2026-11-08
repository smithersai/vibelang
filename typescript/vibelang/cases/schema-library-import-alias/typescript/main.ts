import { Schema } from "effect"

export const Example = Schema.Struct({
 at: Schema.Date,
 site: Schema.URL,
 pattern: Schema.RegExp,
 bytes: Schema.Uint8Array,
 cause: Schema.Defect().pipe(Schema.refine((u):u is globalThis.Error=>u instanceof globalThis.Error)),
 renamedSite: Schema.URL,
 renamedDate: Schema.Date,
})
export type Example = typeof Example.Type
export const Single = Schema.Date
export type Single = typeof Single.Type
