package compiler

import "testing"

// The prelude combinators are LIBRARY operations, not compiled constructs, and
// these tests are executed-output tests for that reason: a declaration that
// type-checks and misbehaves at runtime is the exact failure mode `recover` had
// before it was caught passing a Panic to the mapper. Every acceptance below
// runs the emitted JavaScript under node and asserts what the program printed.
//
// The shared table runner and its exact-position assertions live in
// fork_failclosed_test.go. An empty `reject` means the program must compile AND
// print `stdout`.

// TestPinnedForkResultAllCollectsAndStopsAtTheFirstError pins `all` from the
// locked Result operation list in specification/failures.mdx, "Matching and
// Transformation".
//
// The load-bearing row is the second: with TWO failing entries the collected
// Result must carry the FIRST. An implementation that folded right-to-left, or
// that kept scanning and overwrote the error, would still produce a Result and
// would still type-check — only the printed message distinguishes them.
func TestPinnedForkResultAllCollectsAndStopsAtTheFirstError(t *testing.T) {
	const lookup = "export class Missing extends Error {\n" +
		"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
		"}\n" +
		"\n" +
		"function lookup(key: string): Result<string, Missing> {\n" +
		"  if (key !== \"ada\") throw new Missing(key)\n" +
		"  return \"Ada Lovelace\"\n" +
		"}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "every success is collected in authored order",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const every = Result.all([lookup(\"ada\"), lookup(\"ada\")])\n" +
				"  return [every.match({ ok: (values) => values.join(\",\"), error: (error) => error.message })]\n" +
				"}\n",
			stdout: "Ada Lovelace,Ada Lovelace",
		},
		{
			name: "two failures collect the first, not the last",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const partial = Result.all([lookup(\"ada\"), lookup(\"zoe\"), lookup(\"nemo\")])\n" +
				"  return [partial.match({ ok: (values) => values.join(\",\"), error: (error) => error.message })]\n" +
				"}\n",
			stdout: "no entry for zoe",
		},
		{
			name: "an empty collection succeeds with an empty array",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const none = Result.all([])\n" +
				"  return [none.match({ ok: (values) => `${values.length}`, error: () => \"error\" })]\n" +
				"}\n",
			stdout: "0",
		},
		{
			// Identity, not spelling. A module that declares its OWN `Result`
			// shadows the compiler-owned global, so `Result.all` here resolves to
			// an ordinary object member and must be emitted verbatim rather than
			// rewritten onto the prelude runtime.
			name: "a module declaring its own Result is left alone",
			source: "const Result = { all: (values: string[]) => values.join(\"|\") }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [Result.all([\"ada\", \"zoe\"])]\n" +
				"}\n",
			stdout: "ada|zoe",
		},
	})
}

// TestPinnedForkResultTapObservesWithoutChanging pins `tap`/`tapError`, also
// from the locked list. Three separate claims are asserted, and each of them
// can fail independently: the observation fires on the right variant, it does
// NOT fire on the wrong one, and the observed Result is passed through
// unchanged.
func TestPinnedForkResultTapObservesWithoutChanging(t *testing.T) {
	const lookup = "export class Missing extends Error {\n" +
		"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
		"}\n" +
		"\n" +
		"function lookup(key: string): Result<string, Missing> {\n" +
		"  if (key !== \"ada\") throw new Missing(key)\n" +
		"  return \"Ada Lovelace\"\n" +
		"}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "tap fires only on success, tapError only on failure, neither replaces the Result",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const seen: string[] = []\n" +
				"  const present = lookup(\"ada\")\n" +
				"    .tap((value) => { seen.push(`tap ${value}`) })\n" +
				"    .tapError((error) => { seen.push(`tapError ${error.key}`) })\n" +
				"    .unwrapOr(\"none\")\n" +
				"  const absent = lookup(\"zoe\")\n" +
				"    .tap((value) => { seen.push(`tap ${value}`) })\n" +
				"    .tapError((error) => { seen.push(`tapError ${error.key}`) })\n" +
				"    .unwrapOr(\"none\")\n" +
				"  return [...seen, present, absent]\n" +
				"}\n",
			stdout: "tap Ada Lovelace\ntapError zoe\nAda Lovelace\nnone",
		},
		{
			// Observing is not handling. `recover` MUST NOT intercept the
			// distinguished panic channel (specification/failures.mdx, "Panic"),
			// but `tapError` only looks: passing a Panic to an observer cannot
			// convert it into a success, so the observer runs and the Panic still
			// reaches the caller's error branch.
			name:    "tapError observes a Panic and still leaves it in the error channel",
			support: "/**\n * @module\n * @throws {never}\n */\n\n/** No @throws claim: every call charges the distinguished Panic channel. */\nexport function boom(): number {\n  throw new RangeError(\"the host refused\");\n}\n",
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { boom } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const seen: string[] = []\n" +
				"  const observed = Result.try(() => boom())\n" +
				"    .tapError(() => { seen.push(\"tapError ran\") })\n" +
				"    .recover(() => 41)\n" +
				"  return [...seen, observed.match({ ok: (value) => `${value}`, error: () => \"panic survived\" })]\n" +
				"}\n",
			stdout: "tapError ran\npanic survived",
		},
	})
}

// TestPinnedForkOptionalAllAndTap pins `all`, `filter`, `tap`, `isSome`, and
// `isNone` from the locked Optional operation list in
// specification/type-system.mdx, "Optional".
func TestPinnedForkOptionalAllAndTap(t *testing.T) {
	const lookup = "function lookup(id: number): Optional<string> {\n" +
		"  if (id === 1) return \"Ada\"\n" +
		"  return undefined\n" +
		"}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "Optional.all collects every present value and is absent at the first absence",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const every = Optional.all([lookup(1), lookup(1)])\n" +
				"  const partial = Optional.all([lookup(1), lookup(2), lookup(3)])\n" +
				"  return [\n" +
				"    every.match({ some: (values) => values.join(\",\"), none: () => \"none\" }),\n" +
				"    partial.match({ some: (values) => values.join(\",\"), none: () => \"none\" }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "Ada,Ada\nnone",
		},
		{
			name: "filter keeps a present value only when the predicate holds and tap observes only presence",
			source: lookup + "\n" +
				"export function main(): string[] {\n" +
				"  const seen: string[] = []\n" +
				"  const kept = lookup(1).filter((value) => value.length === 3).unwrapOr(\"-\")\n" +
				"  const dropped = lookup(1).filter((value) => value.length === 9).unwrapOr(\"-\")\n" +
				"  lookup(1).tap((value) => { seen.push(`tap ${value}`) })\n" +
				"  lookup(2).tap((value) => { seen.push(`tap ${value}`) })\n" +
				"  return [kept, dropped, `isSome ${lookup(1).isSome()}`, `isNone ${lookup(2).isNone()}`, ...seen]\n" +
				"}\n",
			stdout: "Ada\n-\nisSome true\nisNone true\ntap Ada",
		},
		{
			name: "the whole locked Optional list round-trips through one value",
			source: lookup + "\n" +
				"function shout(id: number): Optional<string> {\n" +
				"  const value = lookup(id).unwrap()\n" +
				"  return value.toUpperCase()\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const present = lookup(1)\n" +
				"  return [\n" +
				"    present.map((value) => value.toUpperCase()).unwrapOr(\"-\"),\n" +
				"    present.andThen((value) => Optional.fromNullable(value.length === 3 ? value : null)).unwrapOr(\"-\"),\n" +
				"    String(present.toNullable()),\n" +
				"    String(lookup(2).toNullable()),\n" +
				"    present.toResult(new Error(\"absent\")).match({ ok: (value) => value, error: (error) => error.message }),\n" +
				"    lookup(2).toResult(new Error(\"absent\")).match({ ok: (value) => value, error: (error) => error.message }),\n" +
				"    shout(1).unwrapOr(\"-\"),\n" +
				"    shout(2).unwrapOr(\"-\"),\n" +
				"  ]\n" +
				"}\n",
			stdout: "ADA\nAda\nAda\nnull\nAda\nabsent\nADA\n-",
		},
		{
			// The same identity discipline as Result: an authored `Optional`
			// shadows the compiler-owned namespace and is untouched.
			name: "a module declaring its own Optional is left alone",
			source: "const Optional = { all: (values: number[]) => values.length }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${Optional.all([1, 2, 3])}`]\n" +
				"}\n",
			stdout: "3",
		},
	})
}

// TestPinnedForkReflectPanicEntersThePanicChannel pins the ambient spelling of
// the panic intrinsic.
//
// docs/DECISIONS.md, "Typed failures" (Locked): "Reflect.panic and
// compiler/runtime invariant failures enter the same distinguished channel."
// The runtime `Reflect` object has no `panic` member, so an implementation that
// declared it and then EMITTED the call would type-check and crash — which is
// why every row here runs the program.
func TestPinnedForkReflectPanicEntersThePanicChannel(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "Reflect.panic reaches the caller's error branch",
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function force(key: string): Result<string, Panic> {\n" +
				"  if (key !== \"ada\") Reflect.panic(`no entry for ${key}`)\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [\n" +
				"    force(\"ada\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n" +
				"    force(\"zoe\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "Ada Lovelace\npanic: no entry for zoe",
		},
		{
			// The two authored spellings must reach the SAME channel, so the
			// same `match` error branch observes both.
			name: "the imported and ambient spellings reach the same channel",
			source: "import { Panic, panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function imported(): Result<string, Panic> {\n" +
				"  panic(\"imported\")\n" +
				"}\n" +
				"\n" +
				"function ambient(): Result<string, Panic> {\n" +
				"  Reflect.panic(\"ambient\")\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [\n" +
				"    imported().match({ ok: (value) => value, error: (error) => `${error.name}: ${error.message}` }),\n" +
				"    ambient().match({ ok: (value) => value, error: (error) => `${error.name}: ${error.message}` }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "Panic: imported\nPanic: ambient",
		},
		{
			// Identity, not spelling: an authored object with a `panic` member is
			// an ordinary object and its call is an ordinary call. A
			// name-matching implementation would rewrite this into an error
			// variant and the program would print the wrong thing.
			name: "an authored object named Reflect keeps an ordinary panic member",
			source: "const Reflect = { panic: (message: string) => `handled ${message}` }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [Reflect.panic(\"locally\")]\n" +
				"}\n",
			stdout: "handled locally",
		},
		{
			// The rest of the ambient Reflect namespace is untouched: only the
			// member the prelude declares is the intrinsic.
			name: "other Reflect members stay ordinary TypeScript",
			source: "export function main(): string[] {\n" +
				"  const source = { name: \"ada\" }\n" +
				"  return [String(Reflect.has(source, \"name\")), Reflect.ownKeys(source).join(\",\")]\n" +
				"}\n",
			stdout: "true\nname",
		},
		{
			// A panic outside the two defined exit positions has no defined
			// Result meaning, so it is refused rather than emitted — the ambient
			// spelling is held to exactly the rule the imported one is.
			name: "Reflect.panic in a value position is refused, not emitted",
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function force(key: string): Result<string, Panic> {\n" +
				"  const value = key === \"ada\" ? \"Ada Lovelace\" : Reflect.panic(key)\n" +
				"  return value\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [force(\"ada\").unwrapOr(\"none\")]\n" +
				"}\n",
			reject: []string{"SMITHERS1503@4:50"},
		},
	})
}
