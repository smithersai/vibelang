package vibelangfuzz

// The existing Chapter 7 migration oracle checks construction and run behavior
// against the TypeScript input. These keyed cases add sequential recoveries,
// including failures produced by the first fallback, and grouped failures.
func init() {
	for mode := range 3 {
		for _, fallbackFails := range []bool{false, true} {
			key := "alchemy-job-" + string(rune('0'+mode))
			fallback := "Effect.succeed(11)"
			if fallbackFails {
				key += "-fallback-fails"
				fallback = "Effect.fail(new NotFound())"
			}
			source := `import { Data } from "effect"
class Forbidden extends Data.TaggedError("Forbidden") {}
class NotFound extends Data.TaggedError("NotFound") {}
let builds = 0
const request = (): Effect.Effect<number, Forbidden | NotFound> => { builds++; return `
			switch mode {
			case 0:
				source += "Effect.succeed(7)"
			case 1:
				source += "Effect.fail(new Forbidden())"
			case 2:
				source += "Effect.fail(new NotFound())"
			}
			source += ` }
const list = Effect.fn(function* () {
  return yield* request().pipe(
    Effect.catchTag("Forbidden", () => ` + fallback + `),
    Effect.catchTag("NotFound", () => Effect.succeed(0)),
  )
})
export const main = () => {
  const program = list()
  const before = builds
  return Effect.map(program, value => [before, builds, value])
}
`
			migrationPipeStagePrograms = append(migrationPipeStagePrograms, struct{ key, source string }{key, source})
		}
	}
	for _, missing := range []bool{false, true} {
		key := "alchemy-pipe-present"
		request := "Effect.succeed({state: 'active'})"
		if missing {
			key = "alchemy-pipe-missing"
			request = "Effect.fail(new NotFound())"
		}
		source := `import { Data } from "effect"
class NotFound extends Data.TaggedError("NotFound") {}
class Present extends Data.TaggedError("Present")<{readonly state:string}> {}
const describe = (): Effect.Effect<{state:string}, NotFound> => ` + request + `
const awaitGone = Effect.fn(function* () {
  return yield* Effect.gen(function* () {
    const result = yield* describe()
    return yield* Effect.fail(new Present({state: result.state}))
  }).pipe(Effect.catchTag("NotFound", () => Effect.void))
})
export const main = () => Effect.match(awaitGone(), { onFailure: error => error._tag, onSuccess: () => "gone" })
`
		migrationPipeStagePrograms = append(migrationPipeStagePrograms, struct{ key, source string }{key, source})
	}
}
