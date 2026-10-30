import {Schema} from "effect"
const State=Schema.Struct({
 value:Schema.mutableKey(Schema.Number),
 note:Schema.mutableKey(Schema.optional(Schema.String)),
 nested:Schema.mutableKey(Schema.Struct({active:Schema.mutableKey(Schema.Boolean)})),
 items:Schema.Array(Schema.Number),
 locked:Schema.mutableKey(Schema.Array(Schema.Number)),
})
type State=typeof State.Type
const state:State={value:1,nested:{active:false},items:[1],locked:[1]}
state.value=2
state.note="ok"
state.nested.active=true
state.locked=[3]
export const result=[state.value,state.note,state.nested.active,state.items,state.locked]
