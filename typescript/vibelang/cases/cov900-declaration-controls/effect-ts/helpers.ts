import {Schema} from "effect"
/** @throws {never} */
export function box<S extends Schema.Top>(value:S){return Schema.Struct({value})}
