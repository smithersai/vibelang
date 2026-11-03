import { Data, Effect, Schema } from "effect"
const trace: string[] = []
function methodKey(): "label" { trace.push("method"); return "label" }
function schemaKey(): "count" { trace.push("schema"); return "count" }
class Plain extends Data.TaggedError("Plain")<{ readonly [token]: number }> {
  [methodKey()](): string { return "label" }
  get message(): string { return "plain" }
}
const token: unique symbol = Symbol("payload")
class Encoded extends Schema.TaggedError<Encoded>()("Encoded", { [schemaKey()]: Schema.Number }) {}
export function main() {
  return Effect.gen(function* () {
    const plain = new Plain({ [token]: 7 })
    const encoded = new Encoded({ count: 8 })
    return [trace.slice(), plain[token], plain.message, encoded.count]
  })
}
