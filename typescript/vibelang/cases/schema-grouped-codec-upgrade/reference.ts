import {Schema} from "effect"
const grouped=Schema.Union([Schema.Literals(["a","b"]),Schema.Null])
class Root extends Schema.TaggedError<Root>()("Root",{value:grouped}) {}
export const reference={
 Grouped:grouped,
 IndividuallyGrouped:Schema.Union([Schema.Literal("a"),Schema.Literal("b")]),
 Row:Schema.Tuple([grouped]),
 Dict:Schema.Record(Schema.String,grouped),
 Named:Schema.Union([Schema.Literals(["x","y"]),Schema.Null]),
 Deep:Schema.Array(Schema.Union([Schema.Union([Schema.Literal("a"),Schema.Literals(["b","c"])]),Schema.Null])),
 Payload:Schema.Struct({first:Schema.String,choice:grouped,last:Schema.Number}),
 Root,
}
