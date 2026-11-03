import { Effect, Schema } from "effect"
const Mutable = Schema.Struct({ value: Schema.mutableKey(Schema.String) })
export function main() { return Effect.sync(() => {
 const item = Schema.decodeUnknownSync(Mutable)({ value: "before" })
 item.value = "after"
 return item
}) }
