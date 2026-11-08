package vibelangfuzz

// Pin19's frozen Smithers conversions moved plain factory construction into
// generators. Fresh full --fix already preserves these witnesses. Chapter 7's
// quoted preservation rule is the oracle; the unconverted TypeScript observer
// detects captured identities and input snapshots instead of inspecting syntax.
const smithersFactorySource = `import { Effect, Schema, Redacted } from "effect"
class ProbeError extends Schema.TaggedError<ProbeError>()("ProbeError", {message: Schema.String}) {}
export const namespace = (bank: string) => Effect.succeed({namespace: {kind: "flow", id: bank}, bank})
export function unsupported(): Effect.Effect<never, ProbeError> {
  return Effect.fail(new ProbeError({message: "unsupported"}))
}
export const search = () => {
  const unavailable = () => Effect.fail(new ProbeError({message: "unavailable"}))
  return {grep: unavailable, glob: unavailable}
}
export const digest = (value: string) => /^[0-9a-f]{64}$/.test(value)
  ? Effect.succeed(value) : Effect.fail(new ProbeError({message: "digest"}))
export const checked = <R extends {readonly exitCode: number}>(result: R) =>
  result.exitCode === 0 ? Effect.succeed(result) : Effect.fail(new ProbeError({message: "nonzero"}))
export const tree = (contents: Map<string, string>) => ({
  readFile(file: string) { const value = contents.get(file); return Effect.succeed(value) },
  readDirectory: () => Effect.succeed([...contents.keys()])
})
export const occurrences = (schedule: string): Effect.Effect<readonly string[], ProbeError> =>
  schedule === "none" ? Effect.succeed([]) : Effect.fail(new ProbeError({message: "schedule"}))
export const checkValue = (value: Redacted.Redacted<string>) => {
  const revealed = Redacted.value(value)
  return revealed.length === 0 ? Effect.fail(new ProbeError({message: "invalid"})) : Effect.void
}
export const secret = () => Redacted.make("synthetic-valid")
export const wipe = (value: Redacted.Redacted<string>) => Redacted.wipeUnsafe(value)
export const limit = (value: number) => Number.isInteger(value) && value > 0
  ? Effect.succeed(value) : Effect.fail(new ProbeError({message: "limit"}))
export const lazyError = () => Effect.suspend(() => Effect.fail(new ProbeError({message: "lazy"})))
export const lazyValue = () => Effect.sync(() => ({value: "lazy"}))
`

var smithersFactoryPrograms = []struct{ key, factory, body string }{
	{"smithers-resolve-namespace", smithersFactorySource, `
const operation = Factory.namespace("bank")
const first = yield* operation
const second = yield* operation
return [first === second, first.namespace === second.namespace]
`},
	{"smithers-language-server", smithersFactorySource, smithersFailureIdentity("Factory.unsupported()")},
	{"smithers-search", smithersFactorySource, smithersFailureIdentity("Factory.search().grep()")},
	{"smithers-validate-digest", smithersFactorySource, smithersFailureIdentity("Factory.digest('invalid')")},
	{"smithers-checked-exit", smithersFactorySource, `
const input = {exitCode: 0}
const operation = Factory.checked(input)
input.exitCode = 1
let reads = 0
const getter = Factory.checked({get exitCode() { reads++; return 0 }})
const before = reads
yield* getter
yield* getter
const result = yield* Effect.match(operation, {onFailure: () => "failure", onSuccess: () => "success"})
return [result, before, reads]
`},
	{"smithers-remote-tree", smithersFactorySource, `
const contents = new Map([["x", "old"]])
const tree = Factory.tree(contents)
const read = tree.readFile("x")
const listing = tree.readDirectory()
contents.set("x", "new")
contents.set("y", "added")
const value = yield* read
const first = yield* listing
const second = yield* listing
return [value, first === second, first.length]
`},
	{"smithers-catch-up", smithersFactorySource, `
const operation = Factory.occurrences("none")
const first = yield* operation
const second = yield* operation
return [first === second, first.length]
`},
	{"smithers-binding-redacted", smithersFactorySource, `
const secret = Factory.secret()
const operation = Factory.checkValue(secret)
Factory.wipe(secret)
yield* operation
return "success"
`},
	{"smithers-history-limit", smithersFactorySource, smithersFailureIdentity("Factory.limit(0)")},
	{"smithers-already-lazy-error", smithersFactorySource, smithersFailureIdentity("Factory.lazyError()")},
	{"smithers-already-lazy-value", smithersFactorySource, `
const operation = Factory.lazyValue()
const first = yield* operation
const second = yield* operation
return first === second
`},
	{"smithers-held-monitor", factoryBindingSimple, `
const summary = {status: "running"}
const probe = Factory.make(summary.status)
const permit = () => { summary.status = "changed" }
permit()
return yield* probe
`},
	{"smithers-held-sandbox-object", factoryBindingSimple, `
const order: string[] = []
const options = {instance: "old", get startTimeoutMs() { order.push("timeout"); this.instance = "new"; return 1 }}
const start = (instance: string) => { order.push("start"); return Factory.make(instance) }
const operation = start(options.instance)
const timeout = options.startTimeoutMs
void timeout
const value = yield* operation
return [value, order]
`},
}

func smithersFailureIdentity(expression string) string {
	return "const operation = " + expression + `
const observed = Effect.match(operation, {onFailure: error => error, onSuccess: value => value})
const first = yield* observed
const second = yield* observed
return first === second
`
}
