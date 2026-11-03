import { Cause, Data, Effect, Exit, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
class Copied extends Data.TaggedError("Copied")<{ readonly ["__proto__"]: object; readonly value: number }> {}
type Copies = Data.TaggedEnum<{ Copy: { ["__proto__"]: object; value: number } }>
const Copies = Data.taggedEnum<Copies>()
const marker = { marker: true }
const payload = { ["__proto__"]: marker, value: 7 }
export function main() {
  return Effect.gen(function* () {
    const error = new Copied(payload)
    const data = Copies.Copy(payload)
    return [Object.getPrototypeOf(error) === marker, Object.hasOwn(error, "__proto__"), Object.getPrototypeOf(data) === marker, Object.hasOwn(data, "__proto__"), error.value, data.value]
  })
}
