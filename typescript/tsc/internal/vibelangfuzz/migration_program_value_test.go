package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationProgramValueTarget = "FuzzMigrationProgramValue"
const migrationProgramValueQuote = "`try e` is `yield* e`. It runs `e` and gives its success value."

// A yield* whose success is itself a program gives that program as a value,
// and try gives the same value, so --fix writes one for the other and the
// program stays held until something runs it. --fix used to refuse every such
// yield*: Smithers' ArtifactSweep held a guard's check and dropped others,
// Route held a service's Liveness, opencode a helper's finalizer. The generator
// then stayed, and the module's only errors were an unfixed EK1002 and the
// TS2375 its any caused. The oracle compares the fixed module with the same
// source as .ts: main's outcome counts each time the inner program ran.
const migrationProgramValuePrelude = `import { Context, Effect, Layer } from "effect"
let runs = 0
const make = () => Effect.sync(() => Effect.sync(() => ++runs))
`

var migrationProgramValuePrograms = []struct{ key, source string }{
	{"binding", "export const main = () => Effect.gen(function* () {\n  const inner = yield* make()\n  return yield* inner\n})\n"},
	{"returned", "const get = () => Effect.gen(function* () {\n  return yield* make()\n})\nexport const main = () => Effect.gen(function* () {\n  const inner = yield* get()\n  return [runs, yield* inner, runs]\n})\n"},
	{"absent", "const maybe = (n: number) => Effect.sync(() => n > 0 ? Effect.sync(() => ++runs) : undefined)\nexport const main = () => Effect.gen(function* () {\n  const inner = yield* maybe(1)\n  const none = yield* maybe(0)\n  return [inner === undefined ? 0 : yield* inner, none === undefined]\n})\n"},
	{"dropped", "export const main = () => Effect.gen(function* () {\n  yield* make()\n  return runs\n})\n"},
	{"run-at-once", "export const main = () => Effect.gen(function* () {\n  return yield* yield* make()\n})\n"},
	{"run-twice", "export const main = () => Effect.gen(function* () {\n  const inner = yield* make()\n  return [yield* inner, yield* inner]\n})\n"},
	{"element", "export const main = () => Effect.gen(function* () {\n  const held = [yield* make()]\n  return [runs, yield* held[0]!, runs]\n})\n"},
	{"member", "export const main = () => Effect.gen(function* () {\n  const held = { run: yield* make() }\n  return [runs, yield* held.run, runs]\n})\n"},
	{"finalizer", "const listen = () => Effect.acquireRelease(Effect.sync(() => () => Effect.sync(() => ++runs)), (stop) => stop())\nexport const main = () => Effect.scoped(Effect.gen(function* () {\n  const stop = yield* listen()\n  return [runs, yield* stop()]\n}))\n"},
	{"service", "class Env extends Context.Service<Env, Effect.Effect<number>>()(\"Env\") {}\nexport const main = () => Effect.provide(Effect.gen(function* () {\n  const env = yield* Env\n  return [runs, yield* env]\n}), Layer.succeed(Env, Effect.sync(() => ++runs)))\n"},
	{"iterated", "export const main = () => Effect.gen(function* () {\n  let total = 0\n  for (const step of [make(), make()]) {\n    const inner = yield* step\n    total += yield* inner\n  }\n  return total\n})\n"},
	{"exit", "export const main = () => Effect.gen(function* () {\n  const exit = yield* Effect.exit(Effect.sync(() => ++runs))\n  return [exit._tag, runs]\n})\n"},
}

func TestMigrationProgramValueQuoted(t *testing.T) {
	if chapter := SpecText("002-running.md"); !strings.Contains(chapter, migrationProgramValueQuote) {
		t.Fatalf("Chapter 2 no longer says %q", migrationProgramValueQuote)
	}
}
