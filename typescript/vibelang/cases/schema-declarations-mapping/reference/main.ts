import { Effect, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const Address = Schema.Struct({ city: Schema.String })
type Address = typeof Address.Type
const User = Schema.Struct({
  name: Schema.String,
  nick: Schema.optional(Schema.String),
  role: Schema.Literals(["admin", "member"]),
  home: Address,
  count: Schema.NumberFromString,
  numbers: Schema.mutable(Schema.Array(Schema.Number)),
  pair: Schema.mutable(Schema.Tuple([Schema.String, Schema.Number])),
  record: Schema.Record(Schema.String, Schema.mutableKey(Schema.Number)),
  nested: Schema.Struct({ flag: Schema.Boolean }),
  empty: Schema.Null,
  absent: Schema.Undefined,
  mixed: Schema.Union([Schema.String, Schema.Number])
})
type User = typeof User.Type
const Code = Schema.Literals(["a", "b"])
type Code = typeof Code.Type
type Expected = {
  readonly name: string; readonly nick?: string | undefined; readonly role: "admin" | "member"
  readonly home: { readonly city: string }; readonly count: number; readonly numbers: number[]
  readonly pair: [string, number]; readonly record: Record<string, number>
  readonly nested: { readonly flag: boolean }; readonly empty: null; readonly absent: undefined
  readonly mixed: string | number
}
export const exact: Equal<User, Expected> = true
export const code: Equal<Code, "a" | "b"> = true
export function main() {
  return Effect.gen(function* () {
    const input = { name: "Ada", role: "admin", home: { city: "NYC" }, count: "12", numbers: [1], pair: ["x", 2], record: { a: 3 }, nested: { flag: true }, empty: null, absent: undefined, mixed: 4 }
    const a = yield* Schema.decodeUnknownEffect(User)(input)
    const b = yield* Schema.decodeUnknownEffect(User)({ ...input, nick: undefined })
    a.numbers.push(5)
    a.pair[0] = "changed"
    a.record.b = 6
    return [a.count, a.numbers, a.pair, a.record, Schema.is(Code)("a"), Schema.is(Code)("c"), "nick" in a, "nick" in b]
  })
}
