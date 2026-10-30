import {Schema} from "effect"
const Mutable=Schema.mutableKey(Schema.Number)
const nested=Schema.Struct({value:Mutable,count:Schema.Number})
class Root extends Schema.TaggedError<Root>()("Root",{nested}){get label():string{return "kept"}}
export const reference={
 Legacy:Schema.Struct({value:Schema.Number,maybe:Schema.optional(Schema.String),nested:Schema.Struct({count:Schema.Number}),list:Schema.Array(Schema.Number)}),
 Ref:Schema.Struct({value:Mutable,count:Schema.Number}),
 Alias:Schema.Array(Schema.Struct({value:Schema.Number,maybe:Schema.optional(Schema.String)})),
 Scoped:Schema.Struct({value:Mutable,count:Schema.Number}),
 Root,
}
