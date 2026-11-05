package vibelangfuzz

// The existing Chapter 7 migration oracle also covers the DNS module's pure
// dual transforms, arrays of cold programs and provider construction order.
func init() {
	migrationPipeStagePrograms = append(migrationPipeStagePrograms, struct{ key, source string }{"alchemy-dns-provide-order", `import { Layer } from "effect"
export const trace: string[] = []
const makeLayer = () => {
  trace.push("layer:construct")
  return Layer.empty
}
export const provided = Effect.fn(function* (value: number) {
  return yield* Effect.provide(Effect.gen(function* () {
    trace.push("program:run")
    return value
  }), makeLayer())
})
export const main = () => Effect.map(provided(7), value => [value, trace])
`})
}
