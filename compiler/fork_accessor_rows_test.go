package compiler

import "testing"

// An accessor access is an ordinary call, and SMITHERS1802 refuses values.
//
// specification/requirements.mdx §Inference (normative):
//
//	"Calling a function with unsatisfied requirements MUST add those
//	 capabilities to the caller's `R` row. ... Requirement inference MUST be
//	 transitive through ordinary calls."
//
// specification/type-system.mdx §Fallibility Inference adds that `R` is inferred
// "from `Capability.context()` calls and transitive callees", and
// specification/compatibility.mdx scopes the fail-closed rule to "any construct
// whose lowering depends on information the file alone does not carry".
//
// Reading `box.size` CALLS the getter and `box.first = 1` CALLS the setter;
// neither spelling can name the accessor without running it. So an accessor
// access is an ordinary call, its row is transitive, and there is nothing for
// SMITHERS1802 to fail closed on.
//
// The defect this closes came in two halves that had to move together:
//
//  1. SMITHERS1802 refused a cross-module get-only accessor READ, and refused a
//     cross-module direct call made at module top level — both ordinary calls.
//  2. No accessor access charged the accessor's row anywhere, on either
//     backend. A same-module accessor, a setter, and a get/set pair all
//     compiled with the capability silently dropped; only the get-only
//     cross-module read was refused, and only by (1). Relaxing (1) alone would
//     have widened that fail-open from "same-module only" to "always".
//
// The Layer.provide case below is the load-bearing one: before the row edge it
// compiled with zero diagnostics on both backends and aborted at run time.

// TestPinnedForkAccessorAccessChargesItsRow pins the row edge in both
// directions: the requirement must reach the provide site, and must be
// discharged there once the layer supplies it.
func TestPinnedForkAccessorAccessChargesItsRow(t *testing.T) {
	const seam = "seam.mod.sm\x00" + `import { Context } from "smthrs/context"

export abstract class Clock extends Context {
  abstract now(): number
}

export class Stamp {
  get value(): number { return Clock.context().now() }
  set mark(next: number) { Clock.context().now() }
  get pair(): number { return Clock.context().now() }
  set pair(next: number) { Clock.context().now() }
  read(): number { return Clock.context().now() }
}

export function stamp(): Stamp { return new Stamp() }
`
	const imports = "import { Stamp, stamp } from \"./seam.mod.sm\"\n"

	runFailClosedCases(t, []failClosedCase{
		{
			// Every spelling of "read this accessor" at module top level. There
			// is no enclosing function row to carry the capability, exactly as
			// for a top-level call — which has always drawn SMITHERS2102.
			name:    "a top-level getter read reports its unsatisfied requirement",
			modules: []string{seam},
			source:  imports + "const value = stamp().value\nexport function main(): string[] {\n  return [`${value}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:15"},
		},
		{
			name:    "a top-level setter write reports its unsatisfied requirement",
			modules: []string{seam},
			source:  imports + "const holder = stamp()\nholder.mark = 1\nexport function main(): string[] {\n  return [\"x\"]\n}\n",
			reject:  []string{"SMITHERS2102@3:1"},
		},
		{
			name:    "a top-level get-set pair read reports its unsatisfied requirement",
			modules: []string{seam},
			source:  imports + "const value = stamp().pair\nexport function main(): string[] {\n  return [`${value}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:15"},
		},
		{
			name:    "a top-level element access with a literal key reports it too",
			modules: []string{seam},
			source:  imports + "const value = stamp()[\"value\"]\nexport function main(): string[] {\n  return [`${value}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:15"},
		},
		{
			name:    "a top-level destructured getter read reports it too",
			modules: []string{seam},
			source:  imports + "const { value } = stamp()\nexport function main(): string[] {\n  return [`${value}`]\n}\n",
			reject:  []string{"SMITHERS2102@2:9"},
		},
		{
			// THE GATE. Before the row edge this compiled clean on both
			// backends and aborted at run time, because `Clock` — introduced by
			// nothing but the `source.value` read — never reached the closure.
			name:    "a provide site sees a requirement only an accessor read introduces",
			modules: []string{seam},
			source: "import { Context } from \"smthrs/context\"\n" +
				"import { Layer } from \"smthrs/provider\"\n" +
				imports +
				"abstract class Label extends Context {\n  abstract text(): string\n}\n" +
				"function readStamp(source: Stamp): string {\n  return `${Label.context().text()}${source.value}`\n}\n" +
				"const label: Label = { text: () => \"t\" }\n" +
				"export const lines = Layer.provide(Layer.succeed(Label, label), () => [readStamp(stamp())])\n",
			reject: []string{"SMITHERS2101@11:22"},
		},
		{
			// The same program with the capability supplied: the row is
			// discharged and the accessor runs.
			name:    "a satisfied accessor requirement runs",
			modules: []string{seam},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Clock, Stamp, stamp } from \"./seam.mod.sm\"\n" +
				"function readStamp(source: Stamp): number {\n  return source.value\n}\n" +
				"const clock: Clock = { now: () => 7 }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Clock, clock), () => [`${readStamp(stamp())}`])\n}\n",
			stdout: "7",
		},
		{
			// The exact poc/src/data/hash-set.sm shape: a branded value type
			// whose members read a sibling module's get-only accessor. Six such
			// reads were the SMITHERS1802 half of that module's residual errors.
			name: "a cross-module get-only accessor read carries no row and runs",
			modules: []string{"map.mod.sm\x00" + `export class HashMapValue {
  private readonly entries: number[]
  constructor(entries: number[]) { this.entries = entries }
  get size(): number { return this.entries.length }
}

export function mapOf(entries: number[]): HashMapValue { return new HashMapValue(entries) }
`},
			source: "import { HashMapValue, mapOf } from \"./map.mod.sm\"\n" +
				"class HashSetValue {\n" +
				"  private readonly backing: HashMapValue\n" +
				"  constructor(entries: number[]) { this.backing = mapOf(entries) }\n" +
				"  get size(): number { return this.backing.size }\n" +
				"  isEmpty(): boolean { return this.backing.size === 0 }\n" +
				"  toString(): string { return `HashSet(${this.backing.size})` }\n" +
				"}\n" +
				"export function main(): string[] {\n  const set = new HashSetValue([1, 2, 3])\n  return [`${set.size}`, `${set.isEmpty()}`, set.toString()]\n}\n",
			stdout: "3\nfalse\nHashSet(3)",
		},
		{
			name:    "a satisfied destructured accessor requirement runs",
			modules: []string{seam},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Clock, Stamp, stamp } from \"./seam.mod.sm\"\n" +
				"function readStamp(source: Stamp): number {\n  const { value } = source\n  return value\n}\n" +
				"const clock: Clock = { now: () => 7 }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Clock, clock), () => [`${readStamp(stamp())}`])\n}\n",
			stdout: "7",
		},
	})
}

// TestPinnedForkCrossModuleEscapeRefusesValuesNotCalls pins both directions of
// SMITHERS1802 itself: an ordinary call is accepted wherever its row is
// attributed, and a function that becomes a value is still refused.
func TestPinnedForkCrossModuleEscapeRefusesValuesNotCalls(t *testing.T) {
	const registry = "registry.mod.sm\x00" + `export interface Rule {
  readonly name: string
  readonly matches: (value: unknown) => boolean
}

const rules: Rule[] = []

export function register(rule: Rule): void { rules.push(rule) }

export function count(): number { return rules.length }
`
	const imports = "import { register, count } from \"./registry.mod.sm\"\n"

	runFailClosedCases(t, []failClosedCase{
		{
			// The poc/src/data/** shape: a module registering itself with an
			// imported seam at load time, in the one-expression form the
			// package documents.
			name:    "a top-level cross-module registration call is an ordinary call",
			modules: []string{registry},
			source: imports +
				"function isThing(value: unknown): boolean {\n  return typeof value === \"object\"\n}\n" +
				"register({ name: \"Thing\", matches: isThing })\n" +
				"register({ name: \"Other\", matches: (value) => typeof value === \"string\" })\n" +
				"export function main(): string[] {\n  return [`${count()}`]\n}\n",
			stdout: "2",
		},
		{
			name:    "a parenthesized callee resolves and charges what a bare one does",
			modules: []string{registry},
			source:  imports + "export function main(): string[] {\n  return [`${(count)()}`]\n}\n",
			stdout:  "0",
		},
		{
			name:    "a cross-module call in a class property initializer is accepted",
			modules: []string{registry},
			source:  imports + "class Holder {\n  readonly total: number = count()\n}\nexport function main(): string[] {\n  return [`${new Holder().total}`]\n}\n",
			stdout:  "0",
		},
		{
			name:    "a re-exported binding is not an escape",
			modules: []string{registry},
			source:  imports + "export { count }\nexport function main(): string[] {\n  return [`${count()}`]\n}\n",
			stdout:  "0",
		},
		{
			name:    "a typeof entity name is not an escape",
			modules: []string{registry},
			source:  imports + "export type Sig = typeof count\nexport function main(): string[] {\n  return [`${count()}`]\n}\n",
			stdout:  "0",
		},
		{
			name:    "aliasing a cross-module function to a const is still refused",
			modules: []string{registry},
			source:  imports + "export const chosen = count\nexport function main(): string[] {\n  return [`${chosen()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:23"},
		},
		{
			name:    "handing a cross-module function to a callback argument is still refused",
			modules: []string{registry},
			source:  imports + "export function main(): string[] {\n  return [1].map(count).map(String)\n}\n",
			reject:  []string{"SMITHERS1802@3:18"},
		},
		{
			name:    "a cross-module function in an array literal is still refused",
			modules: []string{registry},
			source:  imports + "const table = [count]\nexport function main(): string[] {\n  return [`${table.length}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:16"},
		},
		{
			name:    "a cross-module function as an object literal property is still refused",
			modules: []string{registry},
			source:  imports + "const table = { run: count }\nexport function main(): string[] {\n  return [`${table.run()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:22"},
		},
		{
			// `{ count }` carries the same value `{ count: count }` does. The
			// shorthand's own symbol is the object literal's PROPERTY, which
			// used to let exactly this spelling through on both backends while
			// the explicit one was refused.
			name:    "an object literal shorthand is refused like the explicit spelling",
			modules: []string{registry},
			source:  imports + "const table = { count }\nexport function main(): string[] {\n  return [`${table.count()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:17"},
		},
		{
			name:    "binding a cross-module function is still refused",
			modules: []string{registry},
			source:  imports + "const bound = count.bind(null)\nexport function main(): string[] {\n  return [`${bound()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:15"},
		},
		{
			name:    "a default export expression is still refused",
			modules: []string{registry},
			source:  imports + "export default count\nexport function main(): string[] {\n  return [\"x\"]\n}\n",
			reject:  []string{"SMITHERS1802@2:16"},
		},
		{
			// A tagged template is not a CallExpression: no call edge is built
			// and the callee's row is charged nowhere, so this stays closed.
			name:    "a tagged template callee is still refused",
			modules: []string{"tag.mod.sm\x00export function tag(strings: TemplateStringsArray): string { return strings[0] }\n"},
			source:  "import { tag } from \"./tag.mod.sm\"\nexport function main(): string[] {\n  return [tag`x`]\n}\n",
			reject:  []string{"SMITHERS1802@3:11"},
		},
		{
			// A parameter default is walked by neither the body pass nor the
			// top-level passes, so nothing charges the callee's row there.
			name:    "a cross-module call in a parameter default is still refused",
			modules: []string{registry},
			source:  imports + "export function go(total: number = count()): number {\n  return total\n}\nexport function main(): string[] {\n  return [`${go()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:36"},
		},
		{
			name:    "a namespace-imported function aliased to a const is still refused",
			modules: []string{registry},
			source:  "import * as registry from \"./registry.mod.sm\"\nconst chosen = registry.count\nexport function main(): string[] {\n  return [`${chosen()}`]\n}\n",
			reject:  []string{"SMITHERS1802@2:25"},
		},
	})
}
