package compiler

import (
	"strconv"
	"strings"
	"testing"
)

// Every way a program INVOKES a function, on the Go fork.
//
// Four fail-opens shared one shape: the machinery that charges a callee's row
// was keyed on a call expression, a direct symbol identity, or a variable
// initializer, so every sibling spelling of the same handover walked straight
// through. Each one below was measured on this fork BEFORE the rules existed:
// the refusal cases compiled with ZERO diagnostics, and the runnable ones
// executed and read a capability their published row did not name — or swallowed
// a declared failure and exited 0.
//
//  1. INVOCATION FORMS. `` tag`x` ``, `new C()`, an implicit and an explicit
//     `super()`, `Symbol.iterator` reached through spread / `for…of` / array
//     destructuring / `yield*`, `toString`, `Symbol.toPrimitive`, `String()`,
//     string concatenation, `toJSON`, an authored thenable, an authored
//     `@decorator` and `Symbol.asyncIterator` each CALL a checked function, and
//     specification/requirements.mdx §Inference (Locked) governs all of them:
//     "Calling a function with unsatisfied requirements MUST add those
//     capabilities to the caller's `R` row. … Requirement inference MUST be
//     transitive through ordinary calls." The same blind spot silenced
//     SMITHERS1301, SMITHERS1303 and SMITHERS1404 on the tagged-template
//     spelling while refusing the identical call spelling.
//
//  2. ONE ALIAS HOP. resolveFunctionReference matched only direct symbol
//     identity, so `const alias = fallible; hof(alias)` lost SMITHERS1303, the
//     callback requirement row, and the `Result.try` boundary row that
//     `hof(fallible)` keeps.
//
//  3. A MUTABLE LAYER BINDING. collectLayerBindings resolved a `let` from its
//     initializer forever, so a reassigned layer certified a `Layer.provide` as
//     complete and the program panicked.
//
//  4. AND THE OVER-CORRECTION IN THE SAME AREA. `(Db.context)()` was refused as
//     a "detached reference" — advice to invoke it directly as
//     `Capability.context()`, which the program was already doing.
//
// Half of this file is the OTHER direction, and it is the load-bearing half:
// seven over-corrections have shipped in this codebase, one of them exactly
// here. Every refusal is paired with the legitimate spelling that must still
// compile AND RUN and record the RIGHT row — so an empty row panics under the
// layer, and a wrong row draws SMITHERS2101 naming the capability it invented.
//
// These mirror poc/src/language/invocation-forms.test.ts. The shared table
// runner and its exact-position assertions live in fork_failclosed_test.go.

// invocationCapabilities is the capability module every case below reads. `Log`
// exists so an UNSATISFIED case can be provided a layer that is complete and
// wrong: SMITHERS2101 then names the capability the row actually carries, which
// makes an empty row and a misattributed row two distinguishable failures
// rather than one.
const invocationCapabilities = "caps.inv.sm\x00" + `import { Context } from "smthrs/context"

export abstract class Db extends Context {
  abstract read(): string
}

export abstract class Log extends Context {
  abstract note(): string
}
`

// invocationPrelude is the import header and the two services every case shares.
const invocationPrelude = "import { Layer } from \"smthrs/provider\"\n" +
	"import { Db, Log } from \"./caps.inv.sm\"\n" +
	"const db: Db = { read: () => \"DB\" }\n" +
	"const log: Log = { note: () => \"LOG\" }\n"

// unsatisfied provides ONLY `Log`, so a case whose row correctly names `Db`
// draws `SMITHERS2101 Layer.provide is missing {Db}` at the provide call — and a
// case whose row is EMPTY draws nothing at all, which is precisely the fail-open
// being pinned. The position is derived from the source rather than written by
// hand, so a case can be edited without silently asserting the wrong line.
func unsatisfied(body string) (source string, position string) {
	head := invocationPrelude + body
	source = head +
		"const rows = Layer.provide(Layer.succeed(Log, log), () => [f()])\n" +
		"export function main(): string[] { return rows }\n"
	return source, "SMITHERS2101@" + strconv.Itoa(strings.Count(head, "\n")+1) + ":14"
}

// satisfied provides `Db`, so the same program must compile and RUN. The
// provide site is at MODULE scope in both, because SMITHERS2101 is reported
// only where the closure is complete — inside a function the enclosing row
// carries the requirement instead, and the probe would measure nothing.
func satisfied(body string) string {
	return invocationPrelude + body +
		"const rows = Layer.provide(Layer.succeed(Db, db), () => [f()])\n" +
		"export function main(): string[] { return rows }\n"
}

// ---------------------------------------------------------------------------
// 1. Invocation forms — the requirement row
// ---------------------------------------------------------------------------

// TestPinnedForkInvocationFormsChargeTheCalleeRow measures ONE capability-reading
// callee reached through every invocation spelling the grammar offers. Each body
// defines `f`, and `f`'s row must name `Db`.
func TestPinnedForkInvocationFormsChargeTheCalleeRow(t *testing.T) {
	bodies := []struct {
		name string
		body string
	}{
		{
			// The control. This one always worked, and it is here so a rule that
			// merely stopped charging ANYTHING could not pass this file.
			name: "a plain call charges its callee row",
			body: "function g(): string { return Db.context().read() }\nfunction f(): string { return g() }\n",
		},
		{
			name: "a tagged template charges its tag row",
			body: "function tag(parts: TemplateStringsArray): string { return parts[0] + Db.context().read() }\nfunction f(): string { return tag`x` }\n",
		},
		{
			name: "a tagged template with a substitution charges its tag row",
			body: "function tag(parts: TemplateStringsArray, ...values: readonly unknown[]): string {\n" +
				"  return parts[0] + Db.context().read() + values.length\n" +
				"}\n" +
				"function f(): string { return tag`x${1}` }\n",
		},
		{
			name: "a constructor charges its own row",
			body: "class C { readonly v: string; constructor() { this.v = Db.context().read() } }\n" +
				"function f(): string { return new C().v }\n",
		},
		{
			// `new Derived()` runs `Base`'s constructor with no `super()` written
			// anywhere. Asking the checker for the resolved signature is what makes
			// the implicit spelling need no separate case.
			name: "an implicit super constructor charges the base row",
			body: "class Base { readonly v: string; constructor() { this.v = Db.context().read() } }\n" +
				"class Derived extends Base { }\n" +
				"function f(): string { return new Derived().v }\n",
		},
		{
			name: "an explicit super call charges the base row",
			body: "class Base { readonly v: string; constructor() { this.v = Db.context().read() } }\n" +
				"class Derived extends Base { constructor() { super() } }\n" +
				"function f(): string { return new Derived().v }\n",
		},
		{
			name: "spread runs the authored iterator",
			body: "const it = { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }\n" +
				"function f(): string { return [...it].join(\"\") }\n",
		},
		{
			name: "for-of runs the authored iterator",
			body: "const it = { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }\n" +
				"function f(): string { let out = \"\"; for (const x of it) out += x; return out }\n",
		},
		{
			name: "array destructuring runs the authored iterator",
			body: "const it = { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }\n" +
				"function f(): string { const [a] = it; return a ?? \"\" }\n",
		},
		{
			name: "yield* runs the authored iterator",
			body: "const it = { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }\n" +
				"function* outer(): Generator<string> { yield* it }\n" +
				"function f(): string { return [...outer()].join(\"\") }\n",
		},
		{
			name: "a template substitution runs the authored toString",
			body: "const obj = { toString(): string { return Db.context().read() } }\n" +
				"function f(): string { return `${obj}` }\n",
		},
		{
			name: "a template substitution runs the authored Symbol.toPrimitive",
			body: "const obj = { [Symbol.toPrimitive](hint: string): string { return Db.context().read() + hint } }\n" +
				"function f(): string { return `${obj}` }\n",
		},
		{
			name: "String() runs the authored toString",
			body: "const obj = { toString(): string { return Db.context().read() } }\n" +
				"function f(): string { return String(obj) }\n",
		},
		{
			name: "string concatenation runs the authored toString",
			body: "const obj = { toString(): string { return Db.context().read() } }\n" +
				"function f(): string { return \"v \" + obj }\n",
		},
		{
			name: "JSON.stringify runs the authored toJSON",
			body: "const obj = { toJSON(): string { return Db.context().read() } }\n" +
				"function f(): string { return JSON.stringify(obj) }\n",
		},
		{
			// Every decorator runs when the CLASS DEFINITION is evaluated — not
			// when the decorated member is called and not when the class is
			// constructed. Charging it at the decorator node instead put a METHOD
			// decorator inside the decorated method's own scope, where nothing
			// ever runs it, and the program panicked at import time.
			name: "a method decorator is charged where its class is defined",
			body: "function deco(value: unknown, context: ClassMethodDecoratorContext): void {\n" +
				"  void value; void context; void Db.context().read()\n" +
				"}\n" +
				"function f(): string {\n" +
				"  class Holder { @deco m(): string { return \"m\" } }\n" +
				"  return new Holder().m()\n" +
				"}\n",
		},
		{
			name: "a class decorator is charged where its class is defined",
			body: "function deco(target: unknown): void { void target; void Db.context().read() }\n" +
				"function f(): string {\n" +
				"  @deco class Holder { m(): string { return \"m\" } }\n" +
				"  return new Holder().m()\n" +
				"}\n",
		},
	}
	cases := make([]failClosedCase, 0, len(bodies))
	for _, body := range bodies {
		source, position := unsatisfied(body.body)
		cases = append(cases, failClosedCase{
			name:    body.name,
			modules: []string{invocationCapabilities},
			source:  source,
			reject:  []string{position},
		})
	}
	runFailClosedCases(t, cases)
}

// TestPinnedForkAsyncInvocationFormsChargeTheCalleeRow covers the two protocols
// that only exist on an async edge.
func TestPinnedForkAsyncInvocationFormsChargeTheCalleeRow(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "awaiting an authored thenable charges its then row",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"const thenable = { then(resolve: (value: string) => void): void { resolve(Db.context().read()) } }\n" +
				"async function f(): Promise<string> { return await thenable }\n" +
				"const rows = await Layer.provide(Layer.succeed(Log, log), async () => [await f()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@7:20"},
		},
		{
			name:    "for await runs the authored async iterator",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"const it = { async *[Symbol.asyncIterator](): AsyncGenerator<string> { yield Db.context().read() } }\n" +
				"async function f(): Promise<string> { let out = \"\"; for await (const x of it) out += x; return out }\n" +
				"const rows = await Layer.provide(Layer.succeed(Log, log), async () => [await f()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@7:20"},
		},
	})
}

// TestPinnedForkInvocationFormsStillCompileAndRun is the other direction, and it
// is what separates a correct row from "refuse everything". Each program below
// is the SAME program as its refusal twin with a layer that satisfies it: an
// empty row would panic here with `capability 'Db' was not provided`, and a row
// naming the wrong capability would draw SMITHERS2101.
func TestPinnedForkInvocationFormsStillCompileAndRun(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a tagged template runs under a satisfying layer",
			modules: []string{invocationCapabilities},
			source: satisfied("function tag(parts: TemplateStringsArray): string { return parts[0] + Db.context().read() }\n" +
				"function f(): string { return tag`x` }\n"),
			stdout: "xDB",
		},
		{
			name:    "a constructor runs under a satisfying layer",
			modules: []string{invocationCapabilities},
			source: satisfied("class C { readonly v: string; constructor() { this.v = Db.context().read() } }\n" +
				"function f(): string { return new C().v }\n"),
			stdout: "DB",
		},
		{
			name:    "an authored iterator runs under a satisfying layer",
			modules: []string{invocationCapabilities},
			source: satisfied("const it = { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }\n" +
				"function f(): string { let out = \"\"; for (const x of it) out += x; return out }\n"),
			stdout: "DB",
		},
		{
			name:    "an authored toString runs under a satisfying layer",
			modules: []string{invocationCapabilities},
			source: satisfied("const obj = { toString(): string { return Db.context().read() } }\n" +
				"function f(): string { return `${obj}` }\n"),
			stdout: "DB",
		},
	})
}

// TestPinnedForkOrdinaryInvocationFormsRecordNoRow is the negative table. None of
// these programs reads a capability, so a rule that charged the invocation
// SHAPE rather than the checked function it reaches would refuse all of them —
// and every one of them is idiomatic TypeScript.
func TestPinnedForkOrdinaryInvocationFormsRecordNoRow(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "an ordinary tagged template records no row",
			source: "function tag(parts: TemplateStringsArray): string { return parts[0] ?? \"\" }\n" +
				"export function main(): string[] { return [tag`x`] }\n",
			stdout: "x",
		},
		{
			name: "an ordinary new records no row",
			source: "class C { readonly v: string; constructor(p: string) { this.v = p } }\n" +
				"export function main(): string[] { return [new C(\"p\").v] }\n",
			stdout: "p",
		},
		{
			name: "for-of, spread and array destructuring over a plain array record no row",
			source: "export function main(): string[] {\n" +
				"  let total = 0\n" +
				"  for (const n of [1, 2, 3]) total += n\n" +
				"  const [first] = [...[4, 5]]\n" +
				"  return [`${total}`, `${first ?? 0}`]\n" +
				"}\n",
			stdout: "6\n4",
		},
		{
			name: "coercion of plain values records no row",
			source: "export function main(): string[] {\n" +
				"  return [String(1), \"v \" + 2, `t ${3}`, JSON.stringify({ a: 4 })]\n" +
				"}\n",
			stdout: "1\nv 2\nt 3\n{\"a\":4}",
		},
		{
			name: "yield* over a plain array records no row",
			source: "function* outer(): Generator<number> { yield* [1, 2] }\n" +
				"export function main(): string[] { return [`${[...outer()].length}`] }\n",
			stdout: "2",
		},
		{
			name:   "awaiting an ordinary promise records no row",
			source: "export async function main(): Promise<string[]> { return [`${await Promise.resolve(1)}`] }\n",
			stdout: "1",
		},
		{
			// A LOCAL binding spelled `String` is an ordinary function, so the
			// coercion rule must not match it by spelling.
			name: "a local binding spelled String is an ordinary call",
			source: "function String2(v: number): string { return \"\" + v }\n" +
				"export function main(): string[] { return [String2(7)] }\n",
			stdout: "7",
		},
	})
}

// ---------------------------------------------------------------------------
// 1b. The three OTHER rules the same blind spot silenced
// ---------------------------------------------------------------------------

// TestPinnedForkTaggedTemplateObligations pins the rules that were live on the
// call spelling and silent on the tagged-template spelling of the same program.
// Every case asserts BOTH spellings, so the two can never drift apart again.
func TestPinnedForkTaggedTemplateObligations(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a dropped Result from a tagged template is refused exactly as the call is",
			source: "class Boom extends Error { constructor() { super(\"boom\") } }\n" +
				"function tag(parts: TemplateStringsArray): Result<string, Boom> {\n" +
				"  if (parts[0] === \"bad\") throw new Boom()\n" +
				"  return \"ok\"\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  tag`bad`\n" +
				"  tag([\"bad\"] as unknown as TemplateStringsArray)\n" +
				"  return []\n" +
				"}\n",
			reject: []string{"SMITHERS1301@7:3", "SMITHERS1301@8:3"},
		},
		{
			name: "an inferred-fallible substitution needs a contract exactly as an argument does",
			source: "class Boom extends Error { constructor() { super(\"boom\") } }\n" +
				"function hostTag(parts: TemplateStringsArray, ...values: readonly (() => unknown)[]): string {\n" +
				"  for (const value of values) value()\n" +
				"  return parts[0] ?? \"\"\n" +
				"}\n" +
				"function hostCall(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"function fallible(): string { throw new Boom() }\n" +
				"export function main(): string[] {\n" +
				"  return [hostTag`x${fallible}`, hostCall(fallible)]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@7:1", "SMITHERS1303@9:22", "SMITHERS1303@9:43"},
		},
		{
			name: "an async substitution needs a proven owner exactly as an async argument does",
			source: "function hostTag(parts: TemplateStringsArray, ...values: readonly (() => unknown)[]): string {\n" +
				"  for (const value of values) value()\n" +
				"  return parts[0] ?? \"\"\n" +
				"}\n" +
				"function hostCall(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"export function main(): string[] {\n" +
				"  return [hostTag`x${async () => \"y\"}`, hostCall(async () => \"y\")]\n" +
				"}\n",
			reject: []string{"SMITHERS1404@7:22", "SMITHERS1404@7:50"},
		},
		{
			name:    "a capability-reading substitution charges the enclosing row",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function hostTag(parts: TemplateStringsArray, ...values: readonly (() => unknown)[]): string {\n" +
				"  for (const value of values) value()\n" +
				"  return parts[0] ?? \"\"\n" +
				"}\n" +
				"function f(): string { return hostTag`x${() => Db.context().read()}` }\n" +
				"const rows = Layer.provide(Layer.succeed(Log, log), () => [f()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@10:14"},
		},
		{
			// A tagged template that produces a Result and CONSUMES it is an
			// ordinary program and must still run.
			name: "a consumed Result from a tagged template still compiles and runs",
			source: "class Boom extends Error { constructor() { super(\"boom\") } }\n" +
				"function tag(parts: TemplateStringsArray): Result<string, Boom> {\n" +
				"  if (parts[0] === \"bad\") throw new Boom()\n" +
				"  return \"ok\"\n" +
				"}\n" +
				"function use(): Result<string, Boom> { return tag`fine` }\n" +
				"export function main(): string[] { return [use().unwrapOr(\"fallback\")] }\n",
			stdout: "ok",
		},
	})
}

// ---------------------------------------------------------------------------
// 2. One alias hop
// ---------------------------------------------------------------------------

// TestPinnedForkAliasedFunctionValueResolves pins the six indirections that used
// to defeat SMITHERS1303, SMITHERS1404 and the callback requirement row, next to
// the direct spelling they must agree with.
func TestPinnedForkAliasedFunctionValueResolves(t *testing.T) {
	const carrier = "class Boom extends Error { constructor() { super(\"boom\") } }\n" +
		"function hof(callback: () => unknown): string { callback(); return \"x\" }\n" +
		"const fallible = () => { throw new Boom() }\n" +
		"const table = { fallible }\n" +
		"const list = [fallible] as const\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "every indirection to a fallible function value needs the same contract",
			source: carrier +
				"export function main(): string[] {\n" +
				"  const alias = fallible\n" +
				"  const { fallible: destructured } = table\n" +
				"  return [\n" +
				"    hof(fallible),\n" +
				"    hof(alias),\n" +
				"    hof(table.fallible),\n" +
				"    hof(list[0]),\n" +
				"    hof(true ? fallible : fallible),\n" +
				"    hof(fallible.bind(undefined)),\n" +
				"    hof(destructured),\n" +
				"  ]\n" +
				"}\n",
			reject: []string{
				"SMITHERS1303@10:9", "SMITHERS1303@11:9", "SMITHERS1303@12:9",
				"SMITHERS1303@13:9", "SMITHERS1303@14:9", "SMITHERS1303@15:9",
				"SMITHERS1303@16:9",
			},
		},
		{
			name:    "an aliased callback charges the capability row the direct spelling charges",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function hof(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"const capability = (): string => Db.context().read()\n" +
				"function f(): string { const alias = capability; return hof(alias) }\n" +
				"const rows = Layer.provide(Layer.succeed(Log, log), () => [f()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@8:14"},
		},
		{
			name: "an aliased async callback needs the same proven owner",
			source: "function hof(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"const asyncCb = async (): Promise<string> => \"y\"\n" +
				"export function main(): string[] {\n" +
				"  const alias = asyncCb\n" +
				"  return [hof(asyncCb), hof(alias)]\n" +
				"}\n",
			reject: []string{"SMITHERS1404@5:15", "SMITHERS1404@5:29"},
		},
		{
			// THE GUARD, and the reason a MUTABLE binding is declined outright
			// rather than read through its type. Two function values with the same
			// shape have the same TYPE, so narrowing cannot separate them and the
			// binding keeps the type it was initialized with. Reading it here would
			// charge `Log` — a capability this program never reads — while dropping
			// the `Db` it does. A wrong row is worse than no row; this program is
			// accepted, and the remaining hole is the mutable-binding class, not
			// the alias class.
			name:    "a reassigned binding is declined rather than misattributed",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function hof(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"const usesLog = (): string => Log.context().note()\n" +
				"const usesDb = (): string => Db.context().read()\n" +
				"function f(): string { let cb = usesLog; cb = usesDb; return hof(cb) }\n" +
				"const rows = Layer.provide(Layer.merge(Layer.succeed(Db, db), Layer.succeed(Log, log)), () => [f()])\n" +
				"export function main(): string[] { return rows }\n",
			stdout: "x",
		},
		{
			// The other direction for the alias rule: an alias to a function with
			// no failure and no capability is an ordinary value and must stay one.
			name: "an alias to a plain function is an ordinary value",
			source: "function hof(callback: () => unknown): string { callback(); return \"x\" }\n" +
				"const plain = (): string => \"p\"\n" +
				"export function main(): string[] {\n" +
				"  const alias = plain\n" +
				"  return [hof(alias), hof(() => 1), [1, 2].map(alias).length === 2 ? \"ok\" : \"no\"]\n" +
				"}\n",
			stdout: "x\nx\nok",
		},
	})
}

// ---------------------------------------------------------------------------
// 3. A mutable layer binding
// ---------------------------------------------------------------------------

// TestPinnedForkMutableLayerBindingIsRefused pins the const-only rule and, just
// as importantly, that it did not degrade a precise diagnosis into an opaque
// one: a `const` layer that is genuinely MISSING a capability must still draw
// SMITHERS2101 naming it, not the blunt SMITHERS2104.
func TestPinnedForkMutableLayerBindingIsRefused(t *testing.T) {
	const layerPrelude = invocationPrelude +
		"function needsDb(): string { return Db.context().read() }\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a reassigned let layer is opaque",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"let app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)\n" +
				"app = Layer.succeed(Log, log)\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			reject: []string{"SMITHERS2104@9:24"},
		},
		{
			name:    "a reassigned var layer is opaque",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"var app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)\n" +
				"app = Layer.succeed(Log, log)\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			reject: []string{"SMITHERS2104@9:24"},
		},
		{
			name:    "a layer reassigned inside a helper is opaque",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"let app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)\n" +
				"function swap(): void { app = Layer.succeed(Log, log) }\n" +
				"export function main(): string[] {\n" +
				"  swap()\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			reject: []string{"SMITHERS2104@10:24"},
		},
		{
			// A `let` that is never reassigned is refused too. That is FAIL-CLOSED,
			// not proven: nothing here proves the absence of a later write, and the
			// rule is about the binding form rather than a whole-program analysis.
			name:    "a let layer that is never reassigned is still opaque",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"let app = Layer.succeed(Db, db)\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			reject: []string{"SMITHERS2104@8:24"},
		},
		{
			// THE PRECISION TEST. If the const-only rule had been written as "give
			// up on anything uncertain", this would have become SMITHERS2104 and
			// the author would have lost the sentence naming the missing
			// capability.
			name:    "a const layer missing a capability still draws the precise 2101",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"const app = Layer.succeed(Log, log)\n" +
				"const rows = Layer.provide(app, () => [needsDb()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@7:14"},
		},
		{
			name:    "a const layer still resolves and runs",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"const app = Layer.succeed(Db, db)\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			stdout: "DB",
		},
		{
			name:    "a const merge still resolves and runs",
			modules: []string{invocationCapabilities},
			source: layerPrelude +
				"const app = Layer.merge(Layer.succeed(Db, db), Layer.succeed(Log, log))\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(app, () => [needsDb()])\n" +
				"}\n",
			stdout: "DB",
		},
	})
}

// ---------------------------------------------------------------------------
// 4. The over-correction: a parenthesized immediate callee
// ---------------------------------------------------------------------------

// TestPinnedForkParenthesizedContextCalleeRecordsItsRow pins both halves of
// SMITHERS2107 at once. Grouping never detaches a receiver — ECMAScript detaches
// through an assignment, a comma, or an argument position — so `(Db.context)()`
// must record the row and must not be refused, while every spelling that puts
// another node between the member and its call must still be.
func TestPinnedForkParenthesizedContextCalleeRecordsItsRow(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "every grouping of an immediate context callee records the row and runs",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function read(): string[] {\n" +
				"  return [\n" +
				"    Db.context().read(),\n" +
				"    (Db.context)().read(),\n" +
				"    ((Db.context))().read(),\n" +
				"    (Db).context().read(),\n" +
				"    Db[\"context\"]().read(),\n" +
				"    Db.context?.().read(),\n" +
				"  ]\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => read())\n" +
				"}\n",
			stdout: "DB\nDB\nDB\nDB\nDB\nDB",
		},
		{
			// The row is really recorded, not merely un-refused: provided the WRONG
			// layer, the parenthesized spelling names `Db` exactly as the direct
			// spelling does.
			name:    "a parenthesized immediate callee charges the same row the direct spelling charges",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function f(): string { return (Db.context)().read() }\n" +
				"const rows = Layer.provide(Layer.succeed(Log, log), () => [f()])\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2101@6:14"},
		},
		{
			// And the rule it must not swallow. Each of these separates the member
			// from its call with another node, so the row genuinely stops.
			name:    "a genuinely detached context reference is still refused",
			modules: []string{invocationCapabilities},
			source: invocationPrelude +
				"function take(callback: () => Db): string { return callback().read() }\n" +
				"function f(): string[] {\n" +
				"  const held = Db.context\n" +
				"  return [take(Db.context), take((Db.context)), held().read(), Db.context.call(Db).read()]\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => f())\n" +
				"}\n",
			reject: []string{
				"SMITHERS2107@7:16", "SMITHERS2107@8:16", "SMITHERS2107@8:35", "SMITHERS2107@8:64",
			},
		},
	})
}
