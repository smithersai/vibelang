import { Effect, Schema } from "effect"
const Qualified = Schema.Struct({
  at: Schema.Date,
  site: Schema.URL,
  pattern: Schema.RegExp,
  bytes: Schema.Uint8Array,
  cause: Schema.Defect().pipe(Schema.refine((u): u is Error => u instanceof Error)),
})
export function main() {
  return Effect.gen(function* () {
    const good = { at: new Date(0), site: new URL("https://example.test/"), pattern: /x/g, bytes: new Uint8Array([1]), cause: new Error("sample") }
    const probes: unknown[] = [good, { ...good, at: "1970" }, { ...good, site: "https://example.test/" }, { ...good, pattern: "x" }, { ...good, bytes: [1] }, { ...good, cause: { message: "sample" } }]
    return probes.map(Schema.is(Qualified))
  })
}
