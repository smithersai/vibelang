import { Data, Effect, Schema } from "effect"
class Plain extends Data.TaggedError("Plain") {
  label(x: string): string
  label(x: number): number
  label(x: string | number) { return x }
}
class Encoded extends Schema.TaggedError<Encoded>()("Encoded", {}) {
  label(x: string): string
  label(x: number): number
  label(x: string | number) { return x }
}
const plain = new Plain()
const encoded = new Encoded()
export const text: string = plain.label("ok")
export const count: number = encoded.label(7)
export function main() { return Effect.succeed([text, count]) }
