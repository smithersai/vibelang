package compiler

import "testing"

// The requirement row is the contract this language exists to keep, and it
// failed open through four independent mechanisms on this backend. Every case
// below was measured on this fork BEFORE the rules existed: each refusal case
// compiled with zero diagnostics, and the runnable ones executed and read a
// capability their published row did not name.
//
// specification/requirements.mdx §Context Access (normative): "The receiver
// MUST identify a `Context` subclass strongly enough for the compiler to record
// its nominal key." When it did not, this backend recorded NOTHING instead of
// refusing — `lowering.go.txt`'s `if symbol != nil && a.extendsContext(symbol)`
// had silence for its `else`.
//
// Half of this file is the OTHER direction. Six over-corrections have shipped
// in this codebase; a receiver rule that refuses `Db.context()`, a local alias,
// a subclass, an object-property receiver, a `typeof Db` parameter, or an
// ordinary `xs.map` with no capability in it would be worse than the fail-open
// it replaces. Every accepting case here compiles AND RUNS under a layer that
// provides exactly the capabilities the row must contain, so a row that is
// empty panics at run time and a row that names the wrong capability draws
// SMITHERS2101 — neither can pass by being merely accepted.
//
// The shared table runner and its exact-position assertions live in
// fork_failclosed_test.go.

// capabilityModule declares four capabilities and one subclass. `Twin` is
// STRUCTURALLY IDENTICAL to `Db`, which is what triggers TypeScript's union
// subtype reduction: `typeof Db | typeof Twin` reduces to `typeof Db`, and
// nothing in the resulting TYPE remembers the other arm. That is why the
// receiver is resolved syntax first and type second.
const capabilityModule = "caps.mod.sm\x00" + `import { Context } from "smthrs/context"

export abstract class Db extends Context {
  abstract find(id: number): string
}

export abstract class Log extends Context {
  abstract write(line: string): void
}

export abstract class Twin extends Context {
  abstract find(id: number): string
}

export abstract class Sub extends Db { }
`

// TestPinnedForkAmbiguousContextReceiverIsRefused pins SMITHERS2106.
//
// The worst case is the second one: `Db` and `Twin` share a shape, TypeScript
// reduces the union to `typeof Db`, and the row recorded `Db` — a MISATTRIBUTED
// row, not an empty one. The program checked `ok: true`, a
// `Layer.provide(Layer.succeed(Db, db), ...)` satisfied that declared row, and
// it aborted at run time with `capability 'Twin' was not provided`. A
// type-directed receiver resolution cannot see that, because the second arm is
// only in the syntax.
func TestPinnedForkAmbiguousContextReceiverIsRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a ternary over two capabilities pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const flag = Db !== Log\n" +
				"  return [(flag ? Db : Log).context() === undefined ? \"a\" : \"b\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:11"},
		},
		{
			// THE GATE. Certified, layer-satisfied, and it panicked.
			name:    "a ternary over two structurally identical capabilities is not the first arm",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db, Twin } from \"./caps.mod.sm\"\n" +
				"function read(flag: boolean): string {\n" +
				"  return (flag ? Db : Twin).context().find(1)\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => [read(false)])\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:10"},
		},
		{
			name:    "a const bound to a ternary carries the branches its type reduced away",
			modules: []string{capabilityModule},
			source: "import { Db, Twin } from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const flag = Db !== Twin\n" +
				"  const capability = flag ? Db : Twin\n" +
				"  return [capability.context().find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@5:11"},
		},
		{
			name:    "a nullish default over two capabilities pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const held: typeof Log | undefined = Log\n" +
				"  void (held ?? Db).context()\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:8"},
		},
		{
			name:    "a logical-or over two structurally identical capabilities pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Twin } from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const held: typeof Twin | undefined = Twin\n" +
				"  return [((held || Db)).context().find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:11"},
		},
		{
			name:    "a union-typed parameter pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"function read(capability: typeof Db | typeof Log): void {\n" +
				"  void capability.context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  read(Db)\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			// A subclass is a DIFFERENT nominal key, so a union of a class with
			// its own subclass pins nothing either.
			name:    "a union of a capability with its subclass pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Sub } from \"./caps.mod.sm\"\n" +
				"function read(capability: typeof Db | typeof Sub): string {\n" +
				"  return capability.context().find(1)\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [read(Db)]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:10"},
		},
		{
			// `let` is excluded from the const-initializer follow on purpose:
			// the reassignment makes the initializer no evidence at all.
			name:    "a reassigned local pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"function read(flag: boolean): void {\n" +
				"  let capability: typeof Db | typeof Log = Db\n" +
				"  if (flag) capability = Log\n" +
				"  void capability.context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  read(false)\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@5:8"},
		},
		{
			name:    "a tuple element under a union index pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"const registry = [Db, Log] as const\n" +
				"function read(index: 0 | 1): void {\n" +
				"  void registry[index].context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  read(0)\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:8"},
		},
		{
			name:    "an index-signature lookup pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"const table: Record<string, typeof Db | typeof Log> = { db: Db, log: Log }\n" +
				"export function main(): string[] {\n" +
				"  void table[\"db\"].context()\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:8"},
		},
		{
			// A bound never pins the key even when it names EXACTLY ONE class:
			// a subclass of `Db` is still substitutable for `typeof Db`, and its
			// nominal key is a different one.
			name:    "a type parameter bounded by one capability still pins neither",
			modules: []string{capabilityModule},
			source: "import { Db } from \"./caps.mod.sm\"\n" +
				"function read<C extends typeof Db>(capability: C): void {\n" +
				"  void capability.context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  read(Db)\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			name:    "a type parameter with a default bound pins neither",
			modules: []string{capabilityModule},
			source: "import { Db } from \"./caps.mod.sm\"\n" +
				"function read<C extends typeof Db = typeof Db>(capability: C): void {\n" +
				"  void capability.context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  read(Db)\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			// The language's own helper bound, `abstract new (...args: never[])
			// => Context`, names no class at all. A structural cast through it
			// used to erase the row completely.
			name:    "a structural cast inside a generic helper pins neither",
			modules: []string{capabilityModule},
			source: "import { Context } from \"smthrs/context\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"function get<C extends abstract new (...args: never[]) => Context>(capability: C): InstanceType<C> {\n" +
				"  return (capability as unknown as { context(): InstanceType<C> }).context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [get(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:10"},
		},
		{
			name:    "an intersection of two capabilities pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"function read(capability: typeof Db & typeof Log): void {\n" +
				"  void capability.context()\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  void read\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			// An anonymous class extending `Context` has a nominal key no
			// `Layer` can ever name, so the read can never be provided.
			name: "an anonymous class expression pins no nameable key",
			source: "import { Context } from \"smthrs/context\"\n" +
				"export function main(): string[] {\n" +
				"  void (class extends Context { }).context()\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			name:    "a value read out of an object of capabilities pins neither",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  void Object.values({ db: Db, log: Log })[0].context()\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@3:8"},
		},
		{
			name:    "a namespace-qualified ternary pins neither",
			modules: []string{capabilityModule},
			source: "import * as caps from \"./caps.mod.sm\"\n" +
				"export function main(): string[] {\n" +
				"  const flag = caps.Db !== caps.Log\n" +
				"  void (flag ? caps.Db : caps.Log).context()\n" +
				"  return [\"x\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2106@4:8"},
		},
	})
}

// TestPinnedForkPinnedContextReceiversKeepTheirRowAndRun is the other
// direction, and it is not optional: a receiver rule that refuses the pinned
// spellings is a worse defect than the fail-open it replaces.
//
// Each accepting case COMPILES AND RUNS under a layer providing exactly the
// capabilities its rows must contain. An empty row would panic at run time with
// `capability 'X' was not provided`; a row naming the wrong capability would
// draw SMITHERS2101 at the provide site. Acceptance alone proves neither.
func TestPinnedForkPinnedContextReceiversKeepTheirRowAndRun(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			// Sixteen pinned receiver spellings in one program, all reading the
			// SAME capability, under a layer that provides exactly it.
			name:    "every receiver that pins one capability keeps its row and runs",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"const Alias = Db\n" +
				"const registry = { db: Db }\n" +
				"const tuple = [Db] as const\n" +
				"function pick(): typeof Db { return Db }\n" +
				"function parameter(capability: typeof Db): string { return capability.context().find(8) }\n" +
				"function every(): string[] {\n" +
				"  const flag = true\n" +
				"  let assigned: typeof Db = Db\n" +
				"  const held: typeof Db | undefined = Db\n" +
				"  return [\n" +
				"    Db.context().find(1),\n" +
				"    Alias.context().find(2),\n" +
				"    Db[\"context\"]().find(3),\n" +
				"    (Db).context().find(4),\n" +
				"    (((Db))).context().find(5),\n" +
				"    Db?.context().find(6),\n" +
				"    registry.db.context().find(7),\n" +
				"    parameter(Db),\n" +
				"    pick().context().find(9),\n" +
				"    tuple[0].context().find(10),\n" +
				"    (flag ? Db : Db).context().find(11),\n" +
				"    (flag ? Db : Alias).context().find(12),\n" +
				"    ((flag && Db) || Db).context().find(13),\n" +
				"    (held ?? Db).context().find(14),\n" +
				"    (Db satisfies typeof Db).context().find(15),\n" +
				"    (assigned = Db).context().find(16),\n" +
				"  ]\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => every())\n" +
				"}\n",
			stdout: "row 1\nrow 2\nrow 3\nrow 4\nrow 5\nrow 6\nrow 7\nrow 8\nrow 9\nrow 10\nrow 11\nrow 12\nrow 13\nrow 14\nrow 15\nrow 16",
		},
		{
			// A cast is asked about its OPERAND first, because `as` changes the
			// type and never the value. Both spellings call `Db`'s inherited
			// static at run time and both used to record an empty row while
			// doing it, so the fix is a CORRECT ROW, not a refusal of casts.
			name:    "a cast through any keeps the operand's row and runs",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"function read(): string[] {\n" +
				"  const opaque: any = Db\n" +
				"  return [\n" +
				"    (Db as any).context().find(1),\n" +
				"    (Db as unknown as { context(): Db }).context().find(2),\n" +
				"    opaque.context().find(3),\n" +
				"  ]\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => read())\n" +
				"}\n",
			stdout: "row 1\nrow 2\nrow 3",
		},
		{
			// The asserted type stays the fallback for an operand carrying no
			// capability evidence of its own. Refusing every cast would have
			// taken this with it.
			name:    "a cast over an opaque value records the asserted capability",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"function read(opaque: unknown): string {\n" +
				"  return (opaque as typeof Db).context().find(1)\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => [read(Db)])\n" +
				"}\n",
			stdout: "row 1",
		},
		{
			// A subclass receiver is its OWN nominal key.
			name:    "a subclass receiver records the subclass",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Sub } from \"./caps.mod.sm\"\n" +
				"function read(): string { return Sub.context().find(1) }\n" +
				"const sub: Sub = { find: (id: number) => `sub ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Sub, sub), () => [read()])\n" +
				"}\n",
			stdout: "sub 1",
		},
		{
			// The row identity itself, asserted rather than assumed: the layer
			// deliberately provides the WRONG capability, and the diagnostic
			// must name the right one.
			name:    "a subclass receiver's row is the subclass, not its base",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db, Sub } from \"./caps.mod.sm\"\n" +
				"function read(): string { return Sub.context().find(1) }\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export const lines = Layer.provide(Layer.succeed(Db, db), () => [read()])\n",
			reject: []string{"SMITHERS2101@5:22"},
		},
		{
			// `super.context()` in a static invokes the inherited static with
			// `this` bound to the CONTAINING class, so the checker type of
			// `super` is the one key that read can never have. It recorded the
			// BASE, a base-only layer satisfied it, and the program panicked.
			// The assertion here is the ROW, not a refusal.
			name:    "super.context() in a static records the containing class",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"abstract class Nested extends Db {\n" +
				"  static read(): string { return super.context().find(1) }\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export const lines = Layer.provide(Layer.succeed(Db, db), () => [Nested.read()])\n",
			reject: []string{"SMITHERS2101@7:22"},
		},
		{
			name:    "super.context() in a static runs once the containing class is provided",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"abstract class Nested extends Db {\n" +
				"  static read(): string { return super.context().find(1) }\n" +
				"}\n" +
				"const nested: Nested = { find: (id: number) => `nested ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Nested, nested), () => [Nested.read()])\n" +
				"}\n",
			stdout: "nested 1",
		},
		{
			// An ordinary class with a static named `context` is not a
			// capability, and an object literal with a `context` member is not
			// one either. Neither may be dragged into this rule.
			name: "an ordinary context member on a non-capability stays ordinary",
			source: "class Holder {\n" +
				"  static context(): string { return \"holder\" }\n" +
				"}\n" +
				"const shaped = { context: (): string => \"literal\" }\n" +
				"export function main(): string[] {\n" +
				"  return [Holder.context(), shaped.context()]\n" +
				"}\n",
			stdout: "holder\nliteral",
		},
		{
			// The union rule must not reach a union of two PLAIN classes that
			// happen to publish a `context` method.
			name: "a union of two plain classes with a context method stays ordinary",
			source: "class Left { static context(): string { return \"left\" } }\n" +
				"class Right { static context(): string { return \"right\" } }\n" +
				"export function main(): string[] {\n" +
				"  const flag = true\n" +
				"  return [(flag ? Left : Right).context()]\n" +
				"}\n",
			stdout: "left",
		},
	})
}

// TestPinnedForkDetachedContextReferenceIsRefused pins SMITHERS2107.
//
// The row is recorded at the CALL from the receiver, so every spelling that
// separates the member from its receiver erases the row while keeping the
// capability read. Measured on this backend before the rule: all of these
// compiled `ok: true` with an empty row, and the two runnable ones executed and
// returned the provided service. The reference refused four of them only
// INCIDENTALLY, through the stock type check over its emitted module — a
// verdict resting on a typing accident there and on nothing at all here.
func TestPinnedForkDetachedContextReferenceIsRefused(t *testing.T) {
	const preamble = "import { Db } from \"./caps.mod.sm\"\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "Reflect.apply over the member is a capability read with no row",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [(Reflect.apply(Db.context, Db, []) as Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:26"},
		},
		{
			name:    "Reflect.get with a literal key reaches the same member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  const read = Reflect.get(Db, \"context\") as () => Db\n" +
				"  return [read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:16"},
		},
		{
			name:    "Object.getOwnPropertyDescriptor with a literal key reaches it too",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [Object.getOwnPropertyDescriptor(Db, \"context\") === undefined ? \"a\" : \"b\"]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:11"},
		},
		{
			name:    "call detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [Db.context.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:11"},
		},
		{
			name:    "apply detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [Db.context.apply(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:11"},
		},
		{
			name:    "bind detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [Db.context.bind(Db)().find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:11"},
		},
		{
			name:    "an alias detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  const read = Db.context\n" +
				"  return [read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:16"},
		},
		{
			name:    "an element-access alias detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  const read = Db[\"context\"]\n" +
				"  return [read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:16"},
		},
		{
			name:    "an optional-chain alias detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  const read = Db?.context\n" +
				"  return [read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:16"},
		},
		{
			name:    "a comma expression detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [(0, Db.context)().find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:15"},
		},
		{
			name:    "object destructuring detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "const { context } = Db\n" +
				"export function main(): string[] {\n" +
				"  return [context.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@2:9"},
		},
		{
			name:    "renamed object destructuring detaches it too",
			modules: []string{capabilityModule},
			source: preamble + "const { context: read } = Db\n" +
				"export function main(): string[] {\n" +
				"  return [read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@2:9"},
		},
		{
			name:    "an array literal detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [[Db.context][0].call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:12"},
		},
		{
			name:    "an object literal detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  return [({ get: Db.context }).get.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:19"},
		},
		{
			name:    "a class field detaches the member",
			modules: []string{capabilityModule},
			source: preamble + "class Holder { readonly read = Db.context }\n" +
				"export function main(): string[] {\n" +
				"  return [new Holder().read.call(Db).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@2:32"},
		},
		{
			name:    "handing the member to another function detaches it",
			modules: []string{capabilityModule},
			source: preamble + "function run(read: () => Db): Db { return read() }\n" +
				"export function main(): string[] {\n" +
				"  return [run(Db.context).find(1)]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@4:15"},
		},
		{
			name:    "void, a property read, and interpolation all detach it",
			modules: []string{capabilityModule},
			source: preamble + "export function main(): string[] {\n" +
				"  void Db.context\n" +
				"  return [Db.context.name, `${Db.context}`]\n" +
				"}\n",
			reject: []string{"SMITHERS2107@3:8", "SMITHERS2107@4:11", "SMITHERS2107@4:31"},
		},
		{
			// The other direction. A type position reads nothing, an ordinary
			// object's `context` member is not the language's, and a computed
			// reflective key names no statically known member — see the code
			// comment on checkContextReferences for why that last limit is
			// recorded rather than pretended away.
			name:    "invoking it directly, naming its type, and non-capability members stay legal",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"export type Read = typeof Db.context\n" +
				"const shaped = { context: (): string => \"literal\" }\n" +
				"const { context: shapedRead } = shaped\n" +
				"const dynamicKey: string = \"context\"\n" +
				"function read(): string[] {\n" +
				"  return [\n" +
				"    Db.context().find(1),\n" +
				"    shapedRead(),\n" +
				"    Reflect.get(shaped, \"context\") === undefined ? \"a\" : \"b\",\n" +
				"    Reflect.get(Db, dynamicKey) === undefined ? \"c\" : \"d\",\n" +
				"  ]\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => read())\n" +
				"}\n",
			stdout: "row 1\nliteral\nb\nd",
		},
	})
}

// TestPinnedForkCallbackRequirementsChargeTheCaller closes the third mechanism.
//
// The callback-boundary rules were asymmetric: a callback that can FAIL is
// refused (SMITHERS1303) and an ASYNC one is refused (SMITHERS1404), while a
// callback that REQUIRES a capability crossed the same boundaries with the
// requirement deleted from every row. The callback is invoked synchronously
// inside the enclosing call and reads the capability through the runtime's
// frame stack, so the row is simply wrong.
//
// specification/requirements.mdx §Inference: "Requirement inference MUST be
// transitive through ordinary calls."
func TestPinnedForkCallbackRequirementsChargeTheCaller(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			// Every callback position at once, under a layer providing exactly
			// the capability each of them reads. Before the edge, this program's
			// rows were empty and the provide site had nothing to satisfy.
			name:    "a capability read inside a callback reaches the provide site and runs",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"class Runner { constructor(readonly handlers: { ok: () => string }) {} }\n" +
				"function invoke(read: () => string): string { return read() }\n" +
				"function optional(read?: () => string): string { return read?.() ?? \"none\" }\n" +
				"function runAll(reads: (() => string)[]): string[] { return reads.map((read) => read()) }\n" +
				"function named(id: number): string { return Db.context().find(id) }\n" +
				"const shorthand = (): string => Db.context().find(6)\n" +
				"function every(): string[] {\n" +
				"  return [\n" +
				"    ...[1].map((id) => Db.context().find(id)),\n" +
				"    invoke(() => Db.context().find(2)),\n" +
				"    optional(() => Db.context().find(3)),\n" +
				"    invoke({ ok: () => Db.context().find(4) }.ok),\n" +
				"    ...runAll([() => Db.context().find(5)]),\n" +
				"    invoke(shorthand),\n" +
				"    new Runner({ ok: () => Db.context().find(7) }).handlers.ok(),\n" +
				"    ...[8].map(named),\n" +
				"  ]\n" +
				"}\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"export function main(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => every())\n" +
				"}\n",
			stdout: "row 1\nrow 2\nrow 3\nrow 4\nrow 5\nrow 6\nrow 7\nrow 8",
		},
		{
			// The row identity, asserted at the provide site: the layer omits
			// the capability the callback reads, and the diagnostic names it.
			name:    "a callback's capability is missing from a layer that does not provide it",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db, Log } from \"./caps.mod.sm\"\n" +
				"function read(ids: number[]): string[] { return ids.map((id) => Db.context().find(id)) }\n" +
				"const log: Log = { write: () => undefined }\n" +
				"export const lines = Layer.provide(Layer.succeed(Log, log), () => read([1]))\n",
			reject: []string{"SMITHERS2101@5:22"},
		},
		{
			// THE OVER-CORRECTION THIS FIX COULD HAVE MADE. `Layer.provide`'s
			// computation is excluded from the value edge: checkOneLayer already
			// reconciles that callback's row against the layer's provided
			// closure, and charging it here would republish to the caller
			// exactly the capabilities the provide site satisfies. Asserted
			// flat and nested, and both must RUN.
			name:    "a Layer.provide computation is not charged the capabilities its layer provides",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"function flat(): string { return Layer.provide(Layer.succeed(Db, db), () => Db.context().find(1)) }\n" +
				"function nested(): string[] {\n" +
				"  return Layer.provide(Layer.succeed(Db, db), () => [2].map((id) => Db.context().find(id)))\n" +
				"}\n" +
				"function viaNamed(): string { return Db.context().find(3) }\n" +
				"function named(): string { return Layer.provide(Layer.succeed(Db, db), viaNamed) }\n" +
				"export function main(): string[] {\n" +
				"  return [flat(), ...nested(), named()]\n" +
				"}\n",
			stdout: "row 1\nrow 2\nrow 3",
		},
		{
			// The propagation must not widen into "every higher-order call
			// requires something": a callback with no capability in it charges
			// nothing, and the program needs no layer at all.
			name: "an ordinary callback with no capability charges nothing",
			source: "function twice(values: number[]): number[] { return values.map((value) => value * 2) }\n" +
				"export function main(): string[] {\n" +
				"  return twice([1, 2]).map((value) => `${value}`)\n" +
				"}\n",
			stdout: "2\n4",
		},
	})
}

// TestPinnedForkTopLevelCapabilityReadIsRefused closes the fourth mechanism.
//
// Function rows are collected per FUNCTION, so a capability read written
// directly at module scope was charged to nobody: it compiled with zero
// diagnostics and aborted at run time with `capability 'Db' was not provided`,
// while its INDIRECT spelling — a top-level call to a function whose row names
// the capability — was already refused and is pinned by
// conformance/corpus/05-context-rows/unsatisfied-top-level-requirement. A
// one-line program shape the corpus pins was escapable by inlining the read.
func TestPinnedForkTopLevelCapabilityReadIsRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a direct top-level capability read is refused",
			modules: []string{capabilityModule},
			source: "import { Db } from \"./caps.mod.sm\"\n" +
				"const row = Db.context().find(1)\n" +
				"export function main(): string[] { return [row] }\n",
			reject: []string{"SMITHERS2102@2:13"},
		},
		{
			name:    "a top-level read through an unpinned receiver is refused as ambiguous",
			modules: []string{capabilityModule},
			source: "import { Db, Log } from \"./caps.mod.sm\"\n" +
				"const flag = Db !== Log\n" +
				"const value = (flag ? Db : Log).context()\n" +
				"export function main(): string[] { return [value === undefined ? \"a\" : \"b\"] }\n",
			reject: []string{"SMITHERS2106@3:15"},
		},
		{
			name:    "a capability read inside a top-level callback is refused",
			modules: []string{capabilityModule},
			source: "import { Db } from \"./caps.mod.sm\"\n" +
				"const rows = [1].map((id) => Db.context().find(id))\n" +
				"export function main(): string[] { return rows }\n",
			reject: []string{"SMITHERS2102@2:14"},
		},
		{
			name:    "a capability read inside a top-level constructor argument is refused",
			modules: []string{capabilityModule},
			source: "import { Db } from \"./caps.mod.sm\"\n" +
				"class Runner { constructor(readonly handlers: { ok: () => string }) {} }\n" +
				"const runner = new Runner({ ok: () => Db.context().find(1) })\n" +
				"export function main(): string[] { return [runner.handlers.ok()] }\n",
			reject: []string{"SMITHERS2102@3:16"},
		},
		{
			// The other direction: a top-level read INSIDE a Layer.provide
			// computation has a provider and must stay accepted, and run.
			name:    "a top-level read inside a Layer.provide computation is accepted and runs",
			modules: []string{capabilityModule},
			source: "import { Layer } from \"smthrs/provider\"\n" +
				"import { Db } from \"./caps.mod.sm\"\n" +
				"const db: Db = { find: (id: number) => `row ${id}` }\n" +
				"const rows = Layer.provide(Layer.succeed(Db, db), () => [Db.context().find(1), ...[2].map((id) => Db.context().find(id))])\n" +
				"export function main(): string[] { return rows }\n",
			stdout: "row 1\nrow 2",
		},
	})
}

// TestPinnedForkImportMetaIsRefused pins SMITHERS1601 on the ambient
// `import.meta` namespace.
//
// ECMA-262 hands its properties to the host through
// HostGetImportMetaProperties, so it is host authority by
// alwaysForbiddenHostGlobals' own criterion — but it is a META-PROPERTY, not an
// identifier, and the name-keyed rule never saw it. `import.meta.url` compiled
// with an empty row on both backends and RAN, printing the host filesystem
// path, while `import.meta.dirname` and `import.meta.filename` compiled on the
// reference and answered TS2339 here: the exact backend divergence
// alwaysForbiddenHostGlobals exists to close for their `__dirname` and
// `__filename` siblings.
func TestPinnedForkImportMetaIsRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "every import.meta property read is refused",
			source: "export function whereAmI(): string { return import.meta.url }\n" +
				"export function resolveIt(): string { return import.meta.resolve(\"./x.js\") }\n" +
				"export function directory(): string { return import.meta.dirname }\n" +
				"export function fileName(): string { return import.meta.filename }\n" +
				"export function main(): string[] { return [whereAmI()] }\n",
			reject: []string{
				"SMITHERS1601@1:45", "SMITHERS1601@2:46", "SMITHERS1601@3:46", "SMITHERS1601@4:45",
			},
		},
		{
			name: "a cast, a destructuring, an interpolation, and the bare value are refused too",
			source: "export function env(): unknown { return (import.meta as { env?: unknown }).env }\n" +
				"export function whole(): unknown { const meta = import.meta; return meta }\n" +
				"export function destructured(): string { const { url } = import.meta; return url }\n" +
				"export function interpolated(): string { return `at ${import.meta.url}` }\n" +
				"export function main(): string[] { return [whole() === undefined ? \"a\" : \"b\"] }\n",
			reject: []string{
				"SMITHERS1601@1:42", "SMITHERS1601@2:49", "SMITHERS1601@3:58", "SMITHERS1601@4:55",
			},
		},
		{
			// `new.target` is the other meta-property and is deliberately
			// untouched: it is the language's own and reads nothing from the
			// host. `ImportMeta` as a TYPE reads nothing either.
			name: "new.target and the ImportMeta type stay legal",
			source: "class Maker {\n" +
				"  readonly made: boolean\n" +
				"  constructor() { this.made = new.target !== undefined }\n" +
				"}\n" +
				"export function shape(meta: ImportMeta): string { return typeof meta }\n" +
				"export function main(): string[] { return [new Maker().made ? \"made\" : \"not\"] }\n",
			stdout: "made",
		},
		{
			// An imported `.ts` module keeps its own complete syntax and
			// behaviour (specification/compatibility.mdx §Source Relationship),
			// so `import.meta` inside one is untouched.
			name: "import.meta inside an imported .ts module stays accepted and runs",
			support: "/**\n * @module\n * @throws {never}\n */\n\n" +
				"/** @throws {never} */\n" +
				"export function moduleKind(): string {\n" +
				"  return typeof import.meta.url === \"string\" ? \"esm\" : \"other\";\n" +
				"}\n",
			source: "import { moduleKind } from \"./foreign.ts\"\n" +
				"export function main(): string[] { return [moduleKind()] }\n",
			stdout: "esm",
		},
	})
}
