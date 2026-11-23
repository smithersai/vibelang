// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK9001` | compiler projection error: a source form cannot be represented safely by the stock-TypeScript mapper; use the diagnosed explicit annotation or helper, or the native compiler.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: mapper: `Effect.all(...groups)` with an overload the mapper cannot select | 34 | [Tooling](007-tooling.md#compiler-and-tooling-requirements) |
package vibelangmapper

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
)

// errNotFound is what a test file system returns for a missing file.
var errNotFound = errors.New("not found")

// testContext is the context of every golden: src/main.vibe in the package app.
var testContext = FileContext{FileName: "/app/src/main.vibe", ModuleKey: "app/src/main"}

// projectionCases are the lowering rules, one source and its virtual
// TypeScript each, without the prelude import line (TestImportLine).
// Many rows record the retired implicit-effects language, not the current
// one: testdata/legacy-language.txt lists them, and TestLegacyLanguageCensus
// rejects a new one. Write a new row with `effect` and `try`.
var projectionCases = []struct {
	name        string
	source      string
	virtual     string
	diagnostics []Diagnostic
}{

	{
		name:    "pipe topics use the data method module behind a local shadow",
		source:  "function f(xs: Stream.Stream<number>) { const Stream = 1; return xs |> %.map((n) => n + Stream) }",
		virtual: "function f(xs: Stream.Stream<number>) { const Stream = 1; return (() => { const $topic = xs; return Stream_1.map($topic, (n) => n + Stream) })() }",
	},

	{
		name:    "stream topic method result metadata survives a chain",
		source:  "function f(xs: Stream.Stream<number>) { return xs.filter((n) => n > 0).map((n) => n + 1) }",
		virtual: "function f(xs: Stream.Stream<number>) { return Stream.map(Stream.filter(xs, (n) => n > 0), (n) => n + 1) }",
	},

	{
		name:    "pure module pipe evaluates once",
		source:  "const n = 21 |> % * 2",
		virtual: "const n = (() => { const $topic = 21; return $topic * 2 })()",
	},

	{
		name:    "a service keeps multiline empty channels around interleaved statics",
		source:  "export service Counter {\n increment(): void!!\n static readonly layer = Layer.succeed(Counter, { increment: () => {}, read: () => 2 })\n read(): number!!\n}",
		virtual: "export interface Counter {\n increment(): Effect.Effect<void, never, never>\n read(): Effect.Effect<number, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Counter\" } export abstract class Counter extends $service<Counter>(\"app/src/main#Counter\") { static readonly layer = Layer.succeed(Counter, { increment: () => {}, read: () => 2 })\n \n}",
	},

	{
		name:    "data method call punctuation skips comments",
		source:  "function f(o: Option.Option<number>) { return o.getOrElse /* ( */ (() => 0) }",
		virtual: "function f(o: Option.Option<number>) { return Option.getOrElse(o, () => 0) }",
	},

	{
		name:    "data predicate narrows the original receiver",
		source:  "function f(o: Option.Option<number>) { if (o.isSome()) return o.value; return 0 }",
		virtual: "function f(o: Option.Option<number>) { if (Option.isSome(o)) return o.value; return 0 }",
	},
	{
		name:    "module predicate retains stock narrowing",
		source:  "function f(e: Exit.Exit<number, string>) { return Exit.isFailure(e) ? e.cause : undefined }",
		virtual: "function f(e: Exit.Exit<number, string>) { return Exit.isFailure(e) ? e.cause : undefined }",
	},
	{
		name:    "data method uses the module behind a local shadow",
		source:  "function f(o: Option.Option<number>) { const Option = 1; return o.getOrElse(() => Option) }",
		virtual: "function f(o: Option.Option<number>) { const Option = 1; return Option_1.getOrElse(o, () => Option) }",
	},
	{
		name:    "join a held Fiber",
		source:  "effect function f(a: Fiber.Fiber<number>) { return join a }",
		virtual: "       function f(a: Fiber.Fiber<number>) { return $gen(function* () { return (yield* $run($join(a))) })}",
	},
	{
		name:    "join an array of Fibers",
		source:  "effect function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { return join [a, b] }",
		virtual: "       function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { return $gen(function* () { return (yield* $run($join([a, b]))) })}",
	},
	{
		name:    "join an object of Fibers",
		source:  "effect function f(a: Fiber.Fiber<number>) { return join { a } }",
		virtual: "       function f(a: Fiber.Fiber<number>) { return $gen(function* () { return (yield* $run($join({ a }))) })}",
	},
	{
		name:    "join an annotated collection",
		source:  "effect function f(xs: Fiber.Fiber<number>[]) { return join xs }",
		virtual: "       function f(xs: Fiber.Fiber<number>[]) { return $gen(function* () { return (yield* $run($join(xs))) })}",
	},
	{
		name:    "concurrent unbounded with continue",
		source:  "effect function f(xs: number[]) { for concurrent (const x of xs) { if (x) continue; } }",
		virtual: `       function f(xs: number[]) { return $gen(function* () { ;(yield* $run(Effect.forEach(xs, ($concurrentItem) => $gen(function* () { const x = $concurrentItem; { if (x) return; } }), { concurrency: "unbounded", discard: true }))); })}`,
	},
	{
		name:    "concurrent bounded single statement",
		source:  "effect function f(xs: number[]) { for concurrent(2) (const x of xs) try log(x) }",
		virtual: "       function f(xs: number[]) { return $gen(function* () { ;{ const $concurrency = 2; (yield* $run(Effect.forEach(xs, ($concurrentItem) => $gen(function* () { const x = $concurrentItem; { ;(yield* $run($try(log(x))));  } }), { concurrency: $concurrency, discard: true }))); } })}",
	},
	{
		name:    "concurrent written undefined single statement",
		source:  "effect function f(xs: number[]) { for concurrent(undefined as any) (const x of xs) try log(x) }",
		virtual: "       function f(xs: number[]) { return $gen(function* () { ;{ const $concurrency = undefined as any; (yield* $run(Effect.forEach(xs, ($concurrentItem) => $gen(function* () { const x = $concurrentItem; { ;(yield* $run($try(log(x))));  } }), { concurrency: $concurrency, discard: true }))); } })}",
	},
	{
		name:    "concurrent written null single statement",
		source:  "effect function f(xs: number[]) { for concurrent(null as any) (const x of xs) try log(x) }",
		virtual: "       function f(xs: number[]) { return $gen(function* () { ;{ const $concurrency = null as any; (yield* $run(Effect.forEach(xs, ($concurrentItem) => $gen(function* () { const x = $concurrentItem; { ;(yield* $run($try(log(x))));  } }), { concurrency: $concurrency, discard: true }))); } })}",
	},

	{
		name:    "cold data methods use module functions without running",
		source:  "const price = BigDecimal.make(875n, 2); const total = price.multiply(BigDecimal.fromBigInt(4n))",
		virtual: "const price = BigDecimal.make(875n, 2); const total = BigDecimal.multiply(price, BigDecimal.fromBigInt(4n))",
	},
	{
		name:    "hatch body retains plain JavaScript member semantics",
		source:  "function f() { return sync(() => BigDecimal.make(1n, 0).normalize()) }",
		virtual: "function f() { return sync(() => BigDecimal.make(1n, 0).normalize()) }",
	},

	{
		name:    "schema primitives optional literals arrays and readonly",
		source:  "export schema User { readonly id: string; home?: number; role: \"a\" | \"b\"; tags: string[]; mutable active: boolean }\n",
		virtual: "export interface User extends Schema.Schema.Type<typeof User> {}\nexport const User = Schema.Struct({ id: Schema.String, home: Schema.mutableKey(Schema.optional(Schema.Number)), role: Schema.mutableKey(Schema.Literals([\"a\", \"b\"])), tags: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.String))), active: Schema.mutableKey(Schema.Boolean) });\n",
	},
	{
		name:    "schema alias of a literal union (D280)",
		source:  "export schema Code = \"a\" | \"b\"\n",
		virtual: "export type Code = typeof Code.Type;\nexport const Code = Schema.Literals([\"a\", \"b\"]);\n",
	},
	{
		name:    "schema alias of other forms (D280)",
		source:  "schema Address { city: string }\nschema Home = Address | null;\nschema Pairs = ReadonlyArray<[string, number]>\nschema Point = { x: number }\n",
		virtual: "interface Address extends Schema.Schema.Type<typeof Address> {}\nconst Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) });\ntype Home = typeof Home.Type;\nconst Home = Schema.Union([Address, Schema.Null]);\ntype Pairs = typeof Pairs.Type;\nconst Pairs = Schema.Array(Schema.mutable(Schema.Tuple([Schema.String, Schema.Number])));\ntype Point = typeof Point.Type;\nconst Point = Schema.Struct({ x: Schema.mutableKey(Schema.Number) });\n",
	},
	{
		name:    "schema nested reference",
		source:  "schema Address { city: string }\nschema User { home: Address; point: { x: number } }\n",
		virtual: "interface Address extends Schema.Schema.Type<typeof Address> {}\nconst Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) });\ninterface User extends Schema.Schema.Type<typeof User> {}\nconst User = Schema.Struct({ home: Schema.mutableKey(Address), point: Schema.mutableKey(Schema.Struct({ x: Schema.mutableKey(Schema.Number) })) });\n",
	},
	{
		name:    "catch expression defers a value fallback (D236)",
		source:  "effect function f() { return a() catch 2 }",
		virtual: "       function f() { return $gen(function* () { return (yield* $run($catch(a(), () => $gen(function* () { return 2 })))) })}",
	},
	{
		name:    "catch expression contextually types a handler arrow (D238)",
		source:  "effect function f() { return a() catch (e) => recover(e) }",
		virtual: "       function f() { return $gen(function* () { return (yield* $run($catch(a(), ($catchError => Effect.succeed(((e) => recover(e))($catchError)))))) })}",
	},
	{
		name:    "catch expressions associate to the left (D237)",
		source:  "effect function f() { return a() catch b() catch c }",
		virtual: "       function f() { return $gen(function* () { return (yield* $run($catch((yield* $run($catch(a(), () => $gen(function* () { return b() })))), () => $gen(function* () { return c })))) })}",
	},
	{
		name:    "nullish coalescing stays inside the catch (D237)",
		source:  "effect function f() { return a() ?? 1 catch 2 }",
		virtual: "       function f() { return $gen(function* () { return (yield* $run($catch(a() ?? 1, () => $gen(function* () { return 2 })))) })}",
	},
	{
		name:    "catch expression stays in its conditional branch (D237)",
		source:  "effect function f(ok: boolean) { return ok ? a() catch 1 : 2 }",
		virtual: "       function f(ok: boolean) { return $gen(function* () { return ok ? (yield* $run($catch(a(), () => $gen(function* () { return 1 })))) : 2 })}",
	},
	{
		name:    "catch in a pipe body captures its topic (D237)",
		source:  "declare function find(id: string): string!!; effect function f(id: string) { return id |> find(%) catch 1 }",
		virtual: "declare function find(id: string): Effect.Effect<string, never, never>;        function f(id: string) { return $gen(function* () { return (yield* $run($gen(function* () { const $topic = id; return (yield* $run($catch(find($topic), () => $gen(function* () { return 1 })))) }))) })}",
	},
	{
		name:    "catch expression statement guards ASI",
		source:  "effect function f() {\n  a() catch 1\n}",
		virtual: "       function f() { return $gen(function* () {\n  ;(yield* $run($catch(a(), () => $gen(function* () { return 1 }))))\n})}",
	},
	{
		name:    "catch handler block runs its own Effect body",
		source:  "effect function f() { return a() catch e => { return recover(e) } }",
		virtual: "       function f() { return $gen(function* () { return (yield* $run($catch(a(), ($catchError => Effect.succeed((e => { return recover(e) })($catchError)))))) })}",
	},
	{
		name:    "catch expression retains this in both operands",
		source:  "effect function f() { return this.a() catch this.b() }",
		virtual: "       function f() { return $gen({ self: this }, function* () { return (yield* $run($catch(this.a(), () => $gen({ self: this }, function* () { return this.b() })))) })}",
	},
	{
		name:    "a written catch helper call keeps ordinary call semantics",
		source:  "function f() { return $catchExpression(a, b) }",
		virtual: "function f() { return $catchExpression(a, b) }",
	},
	{
		name:    "nested pipe bodies have distinct lexical topics",
		source:  "function f() { return 1 |> % + (2 |> % * 3) }",
		virtual: "function f() { return (() => { const $topic = 1; return $topic + ((() => { const $topic_1 = 2; return $topic_1 * 3 })()) })() }",
	},
	{
		name:    "an error constructor payload stays a field in virtual TypeScript",
		source:  "error E { constructor: string; get label(): string { return this.constructor } }\n",
		virtual: "class E extends TaggedError(\"E\")<{ readonly constructor: string; }> { declare readonly [\"constructor\"]: string; get label(): string { return this.constructor } }\n",
	},
	{
		name:    "a schema error constructor payload stays a field in virtual TypeScript",
		source:  "schema error E { readonly constructor?: string }\n",
		virtual: "class E extends Schema.TaggedError<E>()(\"E\", { constructor: Schema.optional(Schema.String) }) { declare readonly [\"constructor\"]?: string }\n",
	},
	{
		name:    "a quoted schema error constructor payload keeps its literal key",
		source:  "schema error E { \"constructor\": string }\n",
		virtual: "class E extends Schema.TaggedError<E>()(\"E\", { \"constructor\": Schema.String }) { declare readonly [\"constructor\"]: string }\n",
	},
	{
		name:    "error with a computed constructor field",
		source:  "const key = \"id\" as const; error E { [key]: string }\n",
		virtual: "const key = \"id\" as const; class E extends TaggedError(\"E\")<{ readonly [key]: string }> {}\n",
	},
	{
		name:    "error with fields",
		source:  "error NotFound { id: string }\n",
		virtual: "class NotFound extends TaggedError(\"NotFound\")<{ readonly id: string }> {}\n",
	},
	{
		name:    "exported error without fields",
		source:  "export error Timeout\n",
		virtual: "export class Timeout extends TaggedError(\"Timeout\")<{}> {}\n",
	},
	{
		name:    "an error with a class's members keeps them, its fields declared (D278)",
		source:  "export error Validated implements Coded {\n  code: string\n  mutable count: number\n  static readonly docs = \"x\"\n  constructor(code: string) { super({ code, count: 0 }) }\n  get label(): string { return this.code }\n}\n",
		virtual: "export class Validated extends TaggedError(\"Validated\")<{ readonly code: string; count: number; }> implements Coded {\n  declare readonly code: string\n  declare count: number\n  static readonly docs = \"x\"\n  constructor(code: string) { super({ code, count: 0 }) }\n  get label(): string { return this.code }\n}\n",
	},
	{
		name:    "an abstract family root types its tag as string (D304)",
		source:  "abstract error Http { status: number; abstract describe(): string }\nerror Wide { _tag: string; code: string }\n",
		virtual: "abstract class Http extends TaggedError(\"Http\" as string)<{ readonly status: number; }> { declare readonly status: number; abstract describe(): string }\nclass Wide extends TaggedError(\"Wide\" as string)<{ readonly _tag: string; readonly code: string }> {}\n",
	},
	{
		name:    "a subclass is tagged with its own name (D278)",
		source:  "error Missing extends Wide { path: string }\nerror Bare extends Wide\nerror Own extends Wide { reason: string; constructor(reason: string) { super({ code: reason }); this.reason = reason } }\n",
		virtual: "class Missing extends $errorSubclass(Wide, \"Missing\") { declare readonly _tag: \"Missing\"; constructor(args: $ErrorArgs<typeof Wide, Pick<Missing, \"path\">>) { super(args) } declare readonly path: string }\nclass Bare extends $errorSubclass(Wide, \"Bare\") { declare readonly _tag: \"Bare\"; }\nclass Own extends $errorSubclass(Wide, \"Own\") { declare readonly _tag: \"Own\"; declare readonly reason: string; constructor(reason: string) { super({ code: reason }); this.reason = reason } }\n",
	},
	{
		name:    "a subclass of a generic base takes what the instantiated base takes (D278)",
		source:  "error Child extends Base<number> { own: string }\n",
		virtual: "class Child extends $errorSubclass(Base, \"Child\")<number> { declare readonly _tag: \"Child\"; constructor(args: $ErrorArgs<typeof Base<number>, Pick<Child, \"own\">>) { super(args) } declare readonly own: string }\n",
	},
	{
		name:    "a schema error is a schema class (D279)",
		source:  "schema error FsError { _tag: string; method: string; path?: string }\nschema error Locked extends FsError { holder: string }\n",
		virtual: "class FsError extends Schema.TaggedError<FsError>()(\"FsError\" as string, { method: Schema.String, path: Schema.optional(Schema.String) }) { declare readonly _tag: string; declare readonly method: string; declare readonly path?: string }\nclass Locked extends FsError.extend<Locked>(\"Locked\")({ _tag: Schema.tag(\"Locked\"), holder: Schema.String }) { declare readonly holder: string }\n",
	},
	{
		name:    "generic error",
		source:  "error Wrapped<T> { value: T }\n",
		virtual: "class Wrapped<T> extends TaggedError(\"Wrapped\")<{ readonly value: T }> {}\n",
	},
	{
		name:    "members keep TypeScript's mutability, and mutable goes",
		source:  "interface Counter {\n  label: string\n  mutable count: number\n  readonly id: string\n  [key: string]: unknown\n  tick(): void\n}\ntype P = { x: number; mutable y: number }\n",
		virtual: "interface Counter {\n  label: string\n  count: number\n  readonly id: string\n  [key: string]: unknown\n  tick(): void\n}\ntype P = { x: number; y: number }\n",
	},
	{
		name:    "a member named mutable stays",
		source:  "interface M { mutable: boolean }\n",
		virtual: "interface M { mutable: boolean }\n",
	},
	{
		name:    "contract with every slot",
		source:  "type A = User!NotFound!Db\n",
		virtual: "type A = Effect.Effect<User, NotFound, Db>\n",
	},
	{
		name:    "contract without dependencies",
		source:  "type B = User!NotFound\n",
		virtual: "type B = Effect.Effect<User, NotFound, never>\n",
	},
	{
		name:    "contract with empty slots",
		source:  "type C = User!!Db\ntype D = User!!\ntype E = User!NotFound!\n",
		virtual: "type C = Effect.Effect<User, never, Db>\ntype D = Effect.Effect<User, never, never>\ntype E = Effect.Effect<User, NotFound, never>\n",
	},

	{
		name:    "throw fails",
		source:  "effect function annotated(): User!NotFound! {\n  throw new NotFound({ id: try f(1) })\n}\n",
		virtual: "       function annotated(): Effect.Effect<User, NotFound, never> { return $gen(function* () {\n  return yield* $fail(new NotFound({ id:     (yield* $run($try(f(1)))) }))\n})}\n",
	},
	{
		name:    "a function that only throws keeps A void",
		source:  "effect function find(id: string) {\n  if (id === \"\") throw new Timeout()\n  throw new NotFound({ id })\n}\n",
		virtual: "       function find(id: string) { return $gen(function* () {\n  if (id === \"\") return (yield* $fail(new Timeout())) as void\n  return (yield* $fail(new NotFound({ id }))) as void\n})}\n",
	},

	{
		name:    "plain callbacks retain a contract success type (D67)",
		source:  "import { Schema } from \"effect\"; const s = Schema.suspend((): Effect<Schema.Codec<A, B>, never, never> => s)",
		virtual: `import { Schema } from "effect"; const s = Schema.suspend((): Effect<Schema.Codec<A, B>, never, never> => s)`,
	},

	{
		name:    "omitted dependencies of a contract are never (VIP-3)",
		source:  "effect function find(id: string): string!NotFound {\n  return id\n}\n",
		virtual: "       function find(id: string): Effect.Effect<string, NotFound, never> { return $gen(function* () {\n  return id\n})}\n",
	},
	{
		name:    "a plain return annotation keeps a plain function (L2)",
		source:  "function double(n: number): number {\n  return twice(n)\n}\n",
		virtual: "function double(n: number): number {\n  return twice(n)\n}\n",
	},
	{
		name:    "an iterator contract preserves a JavaScript generator (D271)",
		source:  "function* steps(): Generator<number, number, unknown> { yield f(); return 9 }\n",
		virtual: "function* steps(): Generator<number, number, unknown> { yield f(); return 9 }\n",
	},
	{
		name:    "an iterator-annotated function expression keeps JavaScript delegation (D271)",
		source:  "const steps = function* (): IterableIterator<number> { yield* xs() }\n",
		virtual: "const steps = function* (): IterableIterator<number> { yield* xs() }\n",
	},
	{
		name:    "an async iterator contract preserves await and yield (D271)",
		source:  "async function* steps(): AsyncGenerator<number> { yield await f() }\n",
		virtual: "async function* steps(): AsyncGenerator<number> { yield await f() }\n",
	},
	{
		name:    "top-level calls and async functions stay native; plain generators stay native (VIP-1, VIP-21)",
		source:  "const top = f()\nasync function a() { return f() }\nfunction* g() { yield f() }\n",
		virtual: "const top = f()\nasync function a() { return f() }\nfunction* g() { yield f() }\n",
	},
	{
		name:    "a service is an interface and a key (D45)",
		source:  "export service Users {\n  find(id: string): User!NotFound\n  region: string\n}\n",
		virtual: "export interface Users {\n  find(id: string): Effect.Effect<User, NotFound, never>\n  region: string; readonly \"~vibelang/service\"?: \"app/src/main#Users\" } export abstract class Users extends $service<Users>(\"app/src/main#Users\") {}\n",
	},
	{
		name:    "a service without members is still a key (VIP-9)",
		source:  "service Empty {}\n",
		virtual: "interface Empty { readonly \"~vibelang/service\"?: \"app/src/main#Empty\" } abstract class Empty extends $service<Empty>(\"app/src/main#Empty\") {}\n",
	},
	{
		name:    "a service with a static default is a reference (D40)",
		source:  "service Flags {\n  readonly beta: boolean\n  static readonly defaultValue = () => ({ beta: true })\n}\n",
		virtual: "interface Flags {\n  readonly beta: boolean; readonly \"~vibelang/service\"?: \"app/src/main#Flags\" } abstract class Flags extends $reference<Flags>(\"app/src/main#Flags\") {\n  static readonly defaultValue = () => ({ beta: true })\n}\n",
	},
	{
		name:    "a service of any shape is a brand and a key for its shape (D281)",
		source:  "export service Search: SearchApi {\n  static readonly layer = live\n}\nservice Prefix: string {}\nservice Format: (value: string) => string!! {}\n",
		virtual: "export interface Search { readonly \"~vibelang/service\"?: \"app/src/main#Search\" } export abstract class Search extends $service<Search, SearchApi>(\"app/src/main#Search\") {\n  static readonly layer = live\n}\ninterface Prefix { readonly \"~vibelang/service\"?: \"app/src/main#Prefix\" } abstract class Prefix extends $service<Prefix, string>(\"app/src/main#Prefix\") {}\ninterface Format { readonly \"~vibelang/service\"?: \"app/src/main#Format\" } abstract class Format extends $service<Format, (value: string) => Effect.Effect<string, never, never>>(\"app/src/main#Format\") {}\n",
	},
	{
		name:    "a service of any shape with a static default is a reference to its shape (D281, D40)",
		source:  "service Version: number { static readonly defaultValue = () => 4 }\n",
		virtual: "interface Version { readonly \"~vibelang/service\"?: \"app/src/main#Version\" } abstract class Version extends $reference<number>(\"app/src/main#Version\") { static readonly defaultValue = () => 4 }\n",
	},

	{
		name:    "a provide block provides its layers to a region (D172, D173)",
		source:  "effect function main() {\n  provide AppLive, Clock = clock {\n    return try greet(\"42\")\n  }\n}\n",
		virtual: "       function main() { return $gen(function* () {\n  const $c = yield* $provideEntries([AppLive, $provideService(Clock, \"Clock\", clock)])($gen(function* () {\n    return $box((yield* $run($try(greet(\"42\")))))\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a match expression in an Effect body runs as a program (D206)",
		source:  "effect function f(e: Failure) {\n  const label = match (e) {\n    when NotFound and { let id }: `no user ${id}`;\n    default: try describe(e);\n  }\n  return label\n}\n",
		virtual: "       function f(e: Failure) { return $gen(function* () {\n  const label = (yield* $run($gen(function* () { const $matchCache2 = $matchCache(); void e; { if ($is(NotFound, e) && (typeof e === \"function\" || typeof e === \"object\") && e !== null && \"id\" in e) { let id = e.id; return `no user ${id}`; } } return (yield* $run($try(describe(e)))); })))\n  return label\n})}\n",
	},
	{
		name:    "a returned match returns from its arms, exhaustively (D209)",
		source:  "effect function g(o: Option.Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n    when Option.None: 0;\n  }\n}\n",
		virtual: "       function g(o: Option.Option<number>) { return $gen(function* () {\n  { void o; { const $extracted4 = (Option.isSome(o) ? [o.value] : false); if ($extracted4 !== false && $extracted4.length === 1) { let v = $extracted4[0]; return v; } } { if (Option.isNone(o)) { return 0; } } return $noMatch(o); }\n})}\n",
	},
	{
		name:    "a match statement and an is test",
		source:  "effect function h(n: number) {\n  match (n) {\n    when 1: try log(\"one\");\n    default: try log(\"other\");\n  }\n  return n is 1 or 2\n}\n",
		virtual: "       function h(n: number) { return $gen(function* () {\n  $match2: { void n; { if (n === 1) { (yield* $run($try(log(\"one\")))); break $match2; } } (yield* $run($try(log(\"other\")))); break $match2; } \n  return (((n === 1) || (n === 2)))\n})}\n",
	},

	{
		name:    "interruption blocks and finally (exit) are regions (D178-D180)",
		source:  "effect function f() {\n  uninterruptible {\n    const conn = try acquire()\n    restore { return try use(conn) }\n  }\n}\n",
		virtual: "       function f() { return $gen(function* () {\n  const $c = yield* uninterruptible($gen(function* () {\n    const conn =     (yield* $run($try(acquire())))\n    const $c_1 = yield* restore($gen(function* () { return $box((yield* $run($try(use(conn))))) })); return $c_1\n  })); return $unboxed($c)\n})}\n",
	},

	{
		name:    "a plain generator retains calls and delegation beside Effect iteration (VIP-21)",
		source:  "function* lookups(keys: string[]) {\n  for (const key of keys) yield Store.get(key)\n  yield* more()\n}\neffect function total() {\n  let sum = 0\n  for try (const n of lookups([\"a\"])) sum += n\n  return sum\n}\n",
		virtual: "function* lookups(keys: string[]) {\n  for (const key of keys) yield Store.get(key)\n  yield* more()\n}\n       function total() { return $gen(function* () {\n  let sum = 0\n  for (const n of (yield* $eachStream(lookups([\"a\"])))) sum += n\n  return sum\n})}\n",
	},
	{
		name:    "a layer without statements succeeds with its members",
		source:  "layer UsersLive: Users {\n  find(id) { return lookup(id) }\n  readonly region = \"eu\";\n}\n",
		virtual: "const UsersLive = Layer.succeed(Users, {\n  find(id) { return lookup(id) },\n  region: \"eu\"\n})\n",
	},
	{
		name:    "a layer with statements builds in an Effect",
		source:  "export layer UsersLive: Users {\n  const d = Directory()\n  find(id) { return d.lookup(id) }\n  readonly region = name()\n}\n",
		virtual: "export const UsersLive = Layer.effect(Users, $gen(function* () {\n  const d = Directory()\n  return { find(id) { return d.lookup(id) },\n  region: name() }\n}))\n",
	},
}

// TestCatchExpressionHatch checks D239 at the keyword, including nested
// TypeScript callbacks, while a shadowed hatch name remains ordinary code.
func TestCatchExpressionHatch(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"function f() { return sync(() => a() catch 1) }",
		"function f() { return sync(() => [1].map(() => a() catch 1)) }",
		"function f() { return callback(resume => a() catch 1) }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 1, "%s: %v", source, projection.Diagnostics)
		d := projection.Diagnostics[0]
		assert.Equal(t, d.Code, int32(2114))
		assert.Equal(t, source[d.Start:d.Start+d.Length], "catch")
		assertValidMap(t, projection, source)
	}
	source := "function f() { function sync(f: () => number!!) { return f() }; return sync(() => a() catch 1) }"
	invalid := Project(source, testContext)
	assert.Equal(t, len(invalid.Diagnostics), 1, "%v", invalid.Diagnostics)
	assert.Equal(t, invalid.Diagnostics[0].Code, int32(504))
	source = strings.Replace(source, "sync(() => a() catch 1)", "sync(effect () => a() catch () => 1)", 1)
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
}

// TestCatchExpressionOutsideEffect checks that a top-level or plain-body
// catch asks for an Effect boundary instead of silently returning a program.
func TestCatchExpressionOutsideEffect(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"export const top = a() catch 1",
		"function f(): number { return a() catch 1 }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 1)
		assert.Equal(t, projection.Diagnostics[0].Code, int32(504))
		assertParses(t, projection.Text)
	}
}

// The original unmarked lowering witnesses stay invalid. A surrounding
// expression or expected program return does not turn a source callable effectful.
func TestCatchFixturesRequireExplicitEffect(t *testing.T) {
	for _, source := range []string{
		"function f() { return a() catch 2 }",
		"function f() { return a() catch (e) => recover(e) }",
		"function f() { return a() catch b() catch c }",
		"function f() { return a() ?? 1 catch 2 }",
		"function f(ok: boolean) { return ok ? a() catch 1 : 2 }",
		"declare function find(id: string): string!!; function f(id: string) { return id |> find(%) catch 1 }",
		"function f() {\n  a() catch 1\n}",
		"function f() { return a() catch e => { return recover(e) } }",
		"function f() { return this.a() catch this.b() }",
		"function f() { function sync(f: () => number!!) { return f() }; return sync(() => a() catch 1) }",
	} {
		projection := Project(source, testContext)
		count := 0
		for _, d := range projection.Diagnostics {
			if d.Code == 504 {
				count++
				assert.Equal(t, source[d.Start:d.Start+d.Length], "catch")
			} else {
				assert.Equal(t, d.Code, int32(CodeFormChoice), "%s: %+v", source, d)
			}
		}
		assert.Equal(t, count, strings.Count(source, " catch "), "%s: %+v", source, projection.Diagnostics)
		assertValidMap(t, projection, source)
		assertParses(t, projection.Text)
	}
}

// TestCatchExpressionCorpus checks synthesized match and do operands in
// the runnable case, including its throw handler, lazy fallback, and the
// effect block it passes to exit.
func TestCatchExpressionCorpus(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../../vibelang/cases/catch-expression/main.vibe")
	assert.NilError(t, err)
	source := string(data)
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assertValidMap(t, projection, source)
	assert.Assert(t, strings.Contains(projection.Text, "$run($try(exit($gen("), "exit must receive its effect block operand as a program:\n%s", projection.Text)
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "exit($gen("), "exit must capture the catch operand's defect:\n%s", js)
}

// virtualBody returns projection's text without its first line, the import line.
func virtualBody(t *testing.T, projection Projection) string {
	t.Helper()
	line, rest, ok := strings.Cut(projection.Text, "\n")
	assert.Assert(t, ok && strings.HasPrefix(line, "import {"), "first line: %q", line)
	return rest
}

// TestProjection checks each lowering rule's virtual text, that its span map
// passes the host's validation, and that the virtual text parses as
// TypeScript without syntax errors.
func TestProjection(t *testing.T) {
	t.Parallel()
	for _, c := range projectionCases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			projection := Project(c.source, testContext)
			assert.Equal(t, virtualBody(t, projection), c.virtual)
			assert.Equal(t, len(projection.Diagnostics), len(c.diagnostics), "diagnostics: %v", projection.Diagnostics)
			for i, diagnostic := range c.diagnostics {
				assert.Equal(t, projection.Diagnostics[i], diagnostic)
			}
			assertValidMap(t, projection, c.source)
			assertParses(t, projection.Text)
		})
	}
}

// TestImportLine checks the first line: the prelude names the source uses
// and does not declare, the helpers under names no word of the file
// spells, and the sentinel that fails at line 1 when the prelude cannot
// resolve effect or vibelang-runtime.
func TestImportLine(t *testing.T) {
	t.Parallel()
	source := "const Option = 1\neffect function f() {\n  const $run = 2\n  try Console.log(Option)\n}\nconst L = Layer.empty\n"
	projection := Project(source, testContext)
	line, _, _ := strings.Cut(projection.Text, "\n")
	assert.Equal(t, line, `import { type $PreludeLoaded, $gen, $run as $run_1, $try, Console, Layer } from "vibelang-ts-mapper/prelude"; true satisfies $PreludeLoaded;`)
}

// TestImportLineExperimental checks that the projection imports D313's
// Experimental namespace from the prelude, as the fork resolves it.
func TestImportLineExperimental(t *testing.T) {
	t.Parallel()
	source := "function kind(path: string) {\n  return Experimental.FileSystem.FileSystem.stat(path)\n}\n"
	projection := Project(source, testContext)
	line, _, _ := strings.Cut(projection.Text, "\n")
	assert.Assert(t, strings.Contains(line, ", Experimental }") || strings.Contains(line, " Experimental,"), line)
	assertParses(t, projection.Text)
}

// TestSynthesizedNamesAvoidDeclarations checks that synthesized text names
// a prelude module through an alias when the file declares that name.
func TestSynthesizedNamesAvoidDeclarations(t *testing.T) {
	t.Parallel()
	source := "import { Layer } from \"./mine\"\ntype A = User!!\nfunction g(Effect: number) { return Effect }\nlayer L: S { readonly x = 1 }\n"
	projection := Project(source, testContext)
	line, rest, _ := strings.Cut(projection.Text, "\n")
	assert.Assert(t, strings.Contains(line, "Effect as Effect_1") && strings.Contains(line, "Layer as Layer_1"), line)
	assert.Assert(t, strings.Contains(rest, "type A = Effect_1.Effect<User, never, never>"), rest)
	assert.Assert(t, strings.Contains(rest, "const L = Layer_1.succeed(S, { x: 1 })"), rest)
	assertParses(t, projection.Text)
}

// TestImportedEffectNamespaceKeepsThePreludeType checks that Effect<...> as
// a type means the prelude's type in a file that imports effect's Effect
// module, which has no type (D4), as the fork resolves it.
func TestImportedEffectNamespaceKeepsThePreludeType(t *testing.T) {
	t.Parallel()
	source := "import { Effect } from \"effect\"\ntype A = Effect<string, never, never>\nconst x = Effect.void\nfunction f<Scope>(s: Scope) {}\n"
	projection := Project(source, testContext)
	line, rest, _ := strings.Cut(projection.Text, "\n")
	assert.Assert(t, strings.Contains(line, "Effect as Effect_1"), line)
	assert.Equal(t, rest, "import { Effect } from \"effect\"\ntype A = Effect_1<string, never, never>\nconst x = Effect.void\nfunction f<Scope>(s: Scope) {}\n")
}

// TestVerbatimSegmentsCoverSourceText checks that the identifiers a user
// hovers map back to their own text, so TypeScript's answers at virtual
// positions land on the original ones.
func TestVerbatimSegmentsCoverSourceText(t *testing.T) {
	t.Parallel()
	source := "error EmptyName { name: string }\n\nexport function greet(name: string): string!EmptyName!! {\n  const loud = shout(name)\n  return loud\n}\n"
	projection := Project(source, testContext)
	m := spanmap.New(projection.Segments)
	for _, word := range []string{"EmptyName", "greet", "loud", "shout", "string"} {
		virtual := strings.Index(virtualBody(t, projection), word) + strings.Index(projection.Text, "\n") + 1
		original, fidelity := m.VirtualToOriginalSpan(core.NewTextRange(virtual, virtual+len(word)))
		assert.Assert(t, fidelity.IsExact(), "%s maps with fidelity %v", word, fidelity)
		assert.Equal(t, source[original.Pos():original.End()], word)
	}
}

// TestUnprojectedForm checks that VibeLang syntax without a lowering passes
// through unchanged and draws one EK9001 at the form.
func TestUnprojectedForm(t *testing.T) {
	t.Parallel()
	source := "function f() {\n  return await fiber\n}\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 1)
	d := projection.Diagnostics[0]
	assert.Equal(t, d.Code, int32(CodeUnprojectedForm))
	assertValidMap(t, projection, source)
}

// TestDataDeclarationIsUnprojected checks that the mapper, which does not
// lower data declarations (D307), says so once per declaration, at the
// declaration, and maps the rest of the file.
func TestDataDeclarationIsUnprojected(t *testing.T) {
	t.Parallel()
	source := "export data Delivery {\n  Waiting\n  Sent { tracking: string }\n}\ndata Box<A> { Full { value: A } }\nconst label = \"x\"\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 2, "%v", projection.Diagnostics)
	for i, want := range []string{"export data Delivery {", "data Box<A> {"} {
		d := projection.Diagnostics[i]
		assert.Equal(t, d.Code, int32(CodeUnprojectedForm))
		assert.Assert(t, strings.HasPrefix(source[d.Start:d.Start+d.Length], want), "%q", source[d.Start:d.Start+d.Length])
		assert.Assert(t, strings.Contains(d.Message, "data declaration"), d.Message)
	}
	assertValidMap(t, projection, source)
}

// TestDurableDeclarationIsUnprojected checks that the mapper, which does
// not lower task and workflow declarations (VIP-55), says so once per
// declaration, at the declaration, and maps the rest of the file.
func TestDurableDeclarationIsUnprojected(t *testing.T) {
	t.Parallel()
	source := "task Fetch {\n  effect call(id: string): number!string { return 1 }\n}\nexport workflow Run {\n  effect call(id: string) { return try Fetch(id) }\n}\nconst task = 1\nconst label = task\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 2, "%v", projection.Diagnostics)
	for i, want := range []struct{ head, kind string }{{"task Fetch {", "task declaration"}, {"export workflow Run {", "workflow declaration"}} {
		d := projection.Diagnostics[i]
		assert.Equal(t, d.Code, int32(CodeUnprojectedForm))
		assert.Assert(t, strings.HasPrefix(source[d.Start:d.Start+d.Length], want.head), "%q", source[d.Start:d.Start+d.Length])
		assert.Assert(t, strings.Contains(d.Message, want.kind), d.Message)
	}
	assertValidMap(t, projection, source)
}

// TestProjectionIsDeterministic checks that equal text projects to equal
// output, which TypeScript's content-hash cache relies on.
func TestProjectionIsDeterministic(t *testing.T) {
	t.Parallel()
	for _, c := range projectionCases {
		first, second := Project(c.source, testContext), Project(c.source, testContext)
		assert.DeepEqual(t, first, second)
	}
}

// TestPlanPairs checks that every construct a golden's plan opens, it
// closes, and that each open, middle, and close shares one pair id.
func TestPlanPairs(t *testing.T) {
	t.Parallel()
	for _, c := range projectionCases {
		p := lower(c.source, testContext)
		assert.Assert(t, len(p.plan.unclosed()) == 0, "%s: unclosed %v", c.name, p.plan.unclosed())
		parts := map[int][]part{}
		for _, e := range p.plan.edits {
			if e.pair != 0 {
				parts[e.pair] = append(parts[e.pair], e.part)
			}
		}
		for id, ps := range parts {
			assert.Assert(t, ps[0] == partOpen && ps[len(ps)-1] == partClose, "%s: pair %d has parts %v", c.name, id, ps)
		}
	}
}

// TestCorpusPlans lowers every .vibe file of the case corpus and the
// examples: each must close every construct it opens and render without
// overlapping edits, which would pass the file through unchanged.
func TestCorpusPlans(t *testing.T) {
	t.Parallel()
	var files []string
	for _, pattern := range []string{"../../../vibelang/cases/*/*.vibe", "../../../../examples/*/src/*.vibe"} {
		matches, err := filepath.Glob(pattern)
		assert.NilError(t, err)
		files = append(files, matches...)
	}
	if len(files) == 0 {
		t.Skip("no corpus beside this checkout")
	}
	for _, name := range files {
		text, err := os.ReadFile(name)
		assert.NilError(t, err)
		p := lower(string(text), testContext)
		assert.Assert(t, len(p.plan.unclosed()) == 0, "%s: unclosed %v", name, p.plan.unclosed())
		_, _, overlap, ok := p.plan.render(checking{names: p.names}, string(text), func() string { return "" })
		assert.Assert(t, ok, "%s: overlapping edits at %d", name, overlap)
	}
}

// TestExecutableEdits checks the edits the plan carries for the executable
// rendering: a service's base and a block that is a Scope region of its own.
func TestExecutableEdits(t *testing.T) {
	t.Parallel()
	source := "service Flags { readonly beta: boolean; static readonly defaultValue = () => ({ beta: true }) }\neffect function f() {\n  try g(1)\n  for (;;) {\n    fork g(2)\n  }\n}\n"
	p := lower(source, testContext)
	var bases [][]string
	scopes := 0
	for _, e := range p.plan.edits {
		switch e.kind {
		case editServiceBase:
			bases = append(bases, e.fields)
		case editScopeRegion:
			if e.part == partOpen {
				assert.Equal(t, source[e.pos], byte('{'))
			} else {
				assert.Equal(t, source[e.pos-1], byte('}'))
			}
			scopes++
		}
	}
	assert.DeepEqual(t, bases, [][]string{{"reference", "app/src/main#Flags", "Flags"}})
	assert.Equal(t, scopes, 2) // the loop body's open and close, not the function body's
}

// TestExecutableServiceShape checks that the executable rendering of a
// service of any shape (D281) writes its key around the shape, and passes a
// static default as a reference's.
func TestExecutableServiceShape(t *testing.T) {
	t.Parallel()
	source := "service Prefix: string {}\nservice Version: number { static readonly defaultValue = () => 4 }\n"
	p := lower(source, testContext)
	var texts []string
	for _, e := range p.plan.edits {
		if e.kind == editServiceBase {
			text, ok := executable{}.text(e)
			assert.Assert(t, ok)
			texts = append(texts, text)
		}
	}
	assert.DeepEqual(t, texts, []string{
		helperRef("$service") + "<Prefix, ", `>("app/src/main#Prefix")`,
		helperRef("$reference") + "<", `>("app/src/main#Version", () => Version.defaultValue())`,
	})
}

// TestExecutableRendering checks that the executable rendering drops
// checker-only witnesses and runs a call by a run-time test (L3,
// render_exec.go).
func TestExecutableRendering(t *testing.T) {
	t.Parallel()
	text, keep := executable{}.text(edit{kind: editWitness, text: ", g(x)"})
	assert.Assert(t, !keep && text == "")
	open, _ := executable{}.text(edit{kind: editRun, part: partOpen})
	close, _ := executable{}.text(edit{kind: editRun, part: partClose})
	tmp := helperRef("$t")
	assert.Equal(t, open+"c"+close, "(("+tmp+" = c), "+helperRef("$isRun")+"("+tmp+") ? (yield* "+tmp+") : "+tmp+")")
}

// TestModuleKey checks the fork's key rule: the nearest package.json's name,
// or its directory's, and the module path within it.
func TestModuleKey(t *testing.T) {
	t.Parallel()
	files := map[string]string{
		"/repo/package.json":            `{"name": "@acme/app"}`,
		"/repo/cases/ch01/package.json": `{"private": true}`,
	}
	read := func(name string) ([]byte, error) {
		if text, ok := files[name]; ok {
			return []byte(text), nil
		}
		return nil, errNotFound
	}
	assert.Equal(t, moduleKey("/repo/src/users.vibe", read), "@acme/app/src/users")
	assert.Equal(t, moduleKey("/repo/cases/ch01/main.vibe", read), "ch01/main")
	assert.Equal(t, moduleKey("/elsewhere/main.vibe", read), "main")
}

// TestVersionMismatch checks that a project whose installed effect or
// @effect packages differ from the forms table's pinned versions gets one
// message naming both versions of each, and that agreeing or absent
// packages get none.
func TestVersionMismatch(t *testing.T) {
	t.Parallel()
	header := Header{Inputs: []Input{{Package: "effect", Version: "4.0.6"}, {Package: "@effect/vitest", Version: "4.0.6"}, {Package: "vite", Version: "8.3.4"}}}
	files := map[string]string{
		"/repo/node_modules/effect/package.json":         `{"version": "4.1.1"}`,
		"/repo/node_modules/@effect/vitest/package.json": `{"version": "4.0.6"}`,
		"/repo/node_modules/vite/package.json":           `{"version": "9.0.0"}`,
		"/ok/node_modules/effect/package.json":           `{"version": "4.0.6"}`,
	}
	read := func(name string) ([]byte, error) {
		if text, ok := files[name]; ok {
			return []byte(text), nil
		}
		return nil, errNotFound
	}
	message := versionMismatch(header, "/repo/app", read)
	assert.Assert(t, strings.Contains(message, "effect 4.1.1 (the table pins 4.0.6)"), message)
	assert.Assert(t, !strings.Contains(message, "vitest") && !strings.Contains(message, "vite "), message)
	assert.Equal(t, versionMismatch(header, "/ok", read), "")
	assert.Equal(t, versionMismatch(header, "/none", read), "")
}

// assertValidMap fails unless projection's span map passes the validation
// TypeScript applies to every transform result.
func assertValidMap(t *testing.T, projection Projection, source string) {
	t.Helper()
	if problem := spanmap.New(projection.Segments).Validate(projection.Text, source); problem != nil {
		t.Fatalf("invalid span map: %v", problem)
	}
}

// assertParses fails if text, read as TypeScript, has a syntax error.
func assertParses(t *testing.T, text string) {
	t.Helper()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/virtual.ts")}, text, core.ScriptKindTS)
	for _, d := range file.Diagnostics() {
		t.Errorf("syntax error at %d: %s\n%s", d.Pos(), d.String(), text)
	}
}

// TestSchemaDiagnostics ensures recovery schemas and uncertain references never
// silently turn unsupported field types into accepted schema declarations.
func TestSchemaDiagnostics(t *testing.T) {
	unsupported := Project("schema Event { run(): void; parts: Partial<{ a: string }> }\n", testContext)
	assert.Equal(t, virtualBody(t, unsupported), "interface Event extends Schema.Schema.Type<typeof Event> {}\nconst Event = Schema.Struct({ run: Schema.Never, parts: Schema.mutableKey(Schema.Unknown) });\n")
	assert.Equal(t, len(unsupported.Diagnostics), 2)
	assert.Equal(t, unsupported.Diagnostics[0].Code, int32(1505))
	assert.Equal(t, unsupported.Diagnostics[1].Code, int32(2109))

	for _, source := range []string{
		"schema Event { when: ArrayBuffer; run(): void; parts: Partial<{ a: string }> }",
		"type Alias = string; schema Event { value: Alias }",
		"import type { Remote } from './remote'; schema Event { value: Remote }",
		"schema Run = () => void",
		"schema When = ArrayBuffer",
	} {
		projection := Project(source, testContext)
		assert.Assert(t, len(projection.Diagnostics) > 0, source)
		for _, diagnostic := range projection.Diagnostics {
			want := int32(2109)
			if strings.Contains(source, "run(): void") && strings.Contains(diagnostic.Message, "only typed fields") {
				want = 1505
			}
			assert.Equal(t, diagnostic.Code, want)
		}
		assertParses(t, projection.Text)
	}
}

// TestSchemaExecutable pins the shared plan's runtime schema, including mutable
// and optional keys, without leaking the decoded interface into JavaScript.
func TestSchemaExecutable(t *testing.T) {
	source := "export schema Draft { mutable title: string; tags?: readonly string[]; pair: readonly [number, string]; counts: Record<string, number> }\n"
	projection := Executable(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assert.Assert(t, strings.HasSuffix(projection.Text, "export const Draft = Schema.Struct({ title: Schema.mutableKey(Schema.String), tags: Schema.mutableKey(Schema.optional(Schema.Array(Schema.String))), pair: Schema.mutableKey(Schema.Tuple([Schema.Number, Schema.String])), counts: Schema.mutableKey(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))) });\n"), projection.Text)
	assert.Assert(t, !strings.Contains(projection.Text, "interface Draft"), projection.Text)
	assertParses(t, projection.Text)
}

// TestSchemaConstantReference accepts an explicitly constructed schema value
// and rejects an ordinary value returned by a Schema utility.
func TestSchemaConstantReference(t *testing.T) {
	good := Project("const When = Schema.DateTimeUtc; schema Event { when: When }", testContext)
	assert.Equal(t, len(good.Diagnostics), 0, "%v", good.Diagnostics)
	annotated := Project("const When: Schema.Schema<string> = external; schema Event { when: When }", testContext)
	assert.Equal(t, len(annotated.Diagnostics), 0, "%v", annotated.Diagnostics)
	bad := Project("const When = Schema.is(Schema.String); schema Event { when: When }", testContext)
	assert.Equal(t, len(bad.Diagnostics), 1, "%v", bad.Diagnostics)
	assert.Equal(t, bad.Diagnostics[0].Code, int32(2109))
}

// TestFiberDiagnostics ensures unknown join shapes ask for evidence and
// rejected fiber forms cannot disappear into a never-valued helper result.
func TestFiberDiagnostics(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, source string
		code         int32
	}{
		{"unknown join", "effect function f(x: unknown) { return join x }", CodeFormChoice},
		{"unannotated parameter", "effect function f(x) { return join x }", CodeFormChoice},
		{"unknown call result", "effect function f() { return join external() }", CodeFormChoice},
		{"nonfiber", "effect function f() { const x = 1; return join x }", 1704},
		{"empty object", "effect function f() { return join {} }", 1704},
		{"nested join", "effect function f(a: Fiber.Fiber<number>) { return join [[a]] }", 1704},
		{"nested annotated join", "effect function f(a: Fiber.Fiber<number>[][]) { return join a }", 1704},
		{"Deferred", "effect function f(a: Deferred.Deferred<number>) { return join a }", 1704},
		{"break", "effect function f() { for concurrent (const x of [1]) { break } }", 1903},
		{"return", "effect function f() { for concurrent (const x of [1]) { return x } }", 1904},
	} {
		t.Run(c.name, func(t *testing.T) {
			projection := Project(c.source, testContext)
			found := false
			for _, d := range projection.Diagnostics {
				found = found || d.Code == c.code
			}
			assert.Assert(t, found, "expected %d, got %v", c.code, projection.Diagnostics)
			for _, d := range projection.Diagnostics {
				assert.Assert(t, d.Code != CodeUnprojectedForm, "%v", projection.Diagnostics)
			}
		})
	}
}

// TestConcurrentNestedJumps keeps a nested loop's jumps and a nested
// function's return separate from the concurrent item's continuation.
func TestConcurrentNestedJumps(t *testing.T) {
	source := "effect function f(xs: number[]) { if (xs.length) for concurrent(2) (const x of xs) { for (let i = 0; i < 2; i++) { if (i) break; continue } const g = () => { return x }; if (x) continue; log(x) } }"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "if (xs.length) { const $concurrency = 2; (yield*"), "%s", projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "break; continue"), "%s", projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "if (x) return;"), "%s", projection.Text)
}

// TestConcurrentContinueRegions checks item exits through a nested
// concurrent loop and a parser-generated single-statement block, where
// edits share a span.
func TestConcurrentContinueRegions(t *testing.T) {
	for _, source := range []string{
		"effect function f(xs: number[]) { for concurrent (const x of xs) continue }",
		"effect function f(xs: number[]) { for concurrent (const x of xs) { for concurrent (const y of xs) { if (y) continue } if (x) continue } }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assertParses(t, projection.Text)
		assert.Assert(t, !strings.Contains(virtualBody(t, projection), "continue"), "%s", projection.Text)
	}
}

// TestJoinAnnotatedFactory keeps a plain factory call as the native Fiber
// argument, without adding an implicit Effect execution step.
func TestJoinAnnotatedFactory(t *testing.T) {
	source := "declare function make(): Fiber.Fiber<number>; effect function f() { return join make() }"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "$join(make())"), "%s", projection.Text)
}

// TestFiberFormsInSynthesizedExpressions keeps fiber operations in do and
// match bodies on their own lowering path, including their run edits.
func TestFiberFormsInSynthesizedExpressions(t *testing.T) {
	for _, source := range []string{
		"effect function f(a: Fiber.Fiber<number>) { return do { join a } }",
		"effect function f(a: Fiber.Fiber<number>) { return match (1) { when 1: join a; default: 0; } }",
		"effect function f() { return do { for concurrent (const x of [1]) { log(x) } 1 } }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assertParses(t, projection.Text)
		want := "$run($join("
		if strings.Contains(source, "for concurrent") {
			want = "$run(Effect.forEach("
		}
		assert.Assert(t, strings.Contains(projection.Text, want), "%s", projection.Text)
	}
}

// TestDataMethodTypeArgumentsRequireAnnotation keeps unsupported written
// method instantiations visible instead of guessing a type-argument offset.
func TestDataMethodTypeArgumentsRequireAnnotation(t *testing.T) {
	t.Parallel()
	source := "function f(o: Option.Option<number>) { return o.map<number, string>((n) => String(n)) }"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 1)
	assert.Assert(t, strings.Contains(projection.Diagnostics[0].Message, "annotated module function call"))
	assert.Assert(t, strings.Contains(projection.Text, "o.map<number, string>"))
}

// TestRetiredCatchMigration ensures deleted type-directed clauses request
// the explicit failure/Exit migration in both renderings.
func TestRetiredCatchMigration(t *testing.T) {
	for _, source := range []string{
		"function f() { try { g() } catch (e: Missing) { return 1 } }",
		"function f() { try { g() } catch (cause: Cause) { return 1 } }",
	} {
		projection := Project(source, testContext)
		executable := Executable(source, testContext)
		for _, ds := range [][]Diagnostic{projection.Diagnostics, executable.Diagnostics} {
			assert.Equal(t, len(ds), 1)
			assert.Assert(t, strings.Contains(ds[0].Message, "no longer tests a failure's type"))
			assert.Equal(t, source[ds[0].Start:ds[0].Start+ds[0].Length], "catch")
		}
	}
}

// TestHatchAnnotations keeps unresolved value/function positions from
// silently inheriting the runtime helper's overload guess.
func TestHatchAnnotations(t *testing.T) {
	for _, source := range []string{
		"import { opaque } from './foreign'; function f() { return sync(opaque()) }",
		"import { evaluate } from './foreign'; function f() { return sync(evaluate) }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 1, "%s: %v", source, projection.Diagnostics)
		assert.Assert(t, strings.Contains(projection.Diagnostics[0].Message, "annotat"))
	}
	source := "function f(text: string) { return sync((s) => JSON.parse(s), text) }"
	assert.Equal(t, len(Project(source, testContext).Diagnostics), 0)
}

// TestDoControlFlow pins diagnostics in original coordinates while allowing
// local targets and nested functions, whose returns do not leave the do block.
// The mapper keeps each do expression as its function, so the parser rejects
// what TC39 would let leave it (EK0204).
func TestDoControlFlow(t *testing.T) {
	for _, c := range []struct {
		source, keyword string
		code            int32
	}{
		{"function f() { return do { return 1; 2 } }", "return 1", 204},
		{"function f() { while (true) { const x = do { break; 1 } } }", "break", 204},
		{"function f() { outer: while (true) { const x = do { continue outer; 1 } } }", "continue outer", 204},
		{"function f() { return do { while (true) { break }; 1 } }", "", 0},
		{"function f() { return do { inner: { break inner }; 1 } }", "", 0},
		{"function f() { return do { const g = () => { return 1 }; g() } }", "", 0},
	} {
		got := Project(c.source, testContext)
		if c.code == 0 {
			assert.Equal(t, len(got.Diagnostics), 0, "%v", got.Diagnostics)
			continue
		}
		assert.Equal(t, len(got.Diagnostics), 1, "%s: %v", c.source, got.Diagnostics)
		d := got.Diagnostics[0]
		assert.Equal(t, d.Code, c.code)
		assert.Equal(t, d.Start, strings.Index(c.source, c.keyword))
		assert.Equal(t, c.source[d.Start:d.Start+d.Length], c.keyword+";")
		keyword := strings.Fields(c.keyword)[0]
		assert.Equal(t, d.Message, keyword+" cannot leave this do expression: VibeLang still compiles every do expression for the TS7 mapper to a function. Move the do expression into a statement of its own.")
		_, _, diagnostics := Emit(c.source, testContext)
		assert.DeepEqual(t, diagnostics, got.Diagnostics)
	}
}

// TestHatchDataExports checks provenance so a callable local cannot inherit
// a library data result's permission to project without an annotation.
func TestHatchDataExports(t *testing.T) {
	for _, source := range []string{
		`function f() { return sync(Schema.toCodecJson(Schema.String)) }`,
		`function f() { return sync(Schema.toJsonSchemaDocument(Schema.String)) }`,
		`function f() { return sync(Arbitrary.schema(Schema.String)) }`,
		`import { BigDecimal as B } from "effect"; function f() { return sync(B.fromNumberUnsafe(0)) }`,
	} {
		assert.Equal(t, len(Project(source, testContext).Diagnostics), 0, "%s", source)
		assert.Equal(t, len(Executable(source, testContext).Diagnostics), 0, "%s", source)
	}
	source := `function f(BigDecimal: { fromNumberUnsafe(n: number): () => number }) { return sync(BigDecimal.fromNumberUnsafe(0)) }`
	// VIP-6 permits the capture. Keep the independent callable-value
	// ambiguity diagnostic from the original witness.
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		assert.Equal(t, len(projection.Diagnostics), 1, "%v", projection.Diagnostics)
		assert.Equal(t, projection.Diagnostics[0].Code, int32(CodeUnprojectedForm))
	}
}
