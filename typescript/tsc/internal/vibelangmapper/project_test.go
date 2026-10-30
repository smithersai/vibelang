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
var projectionCases = []struct {
	name        string
	source      string
	virtual     string
	diagnostics []Diagnostic
}{

	{name: "tail resume in a cleanup block cannot invent clause fallthrough",
		source:  `control Ask { get(): boolean!! } function f() { try { return Ask.get() } handle Ask.get() { if (true) { using r = acquire(); resume(true) } else { resume(false) } } }`,
		virtual: `interface Ask { get(): Effect.Effect<boolean, never, never>; readonly "~vibelang/service"?: "app/src/main#Ask" } abstract class Ask extends $service<Ask>("app/src/main#Ask") {} function f() { return $gen(function* () { const $c = yield* handle_1($gen(function* () { return $box((yield* $run($use(Ask).get()))) }) , Ask, { get: ($k) => $gen(function* () { if (true) { const $c_1 = yield* $scopedBody($gen(function* () { const r = (yield* $acquire($value(acquire)())); return $tailResume($k, true) })); return $c_1 } else { return $tailResume($k, false) } }) }); return $unboxed($c) })}`},

	{name: "Match generic stages retain contextual pipe inference",
		source:  "import { Match } from \"effect\"; function phase(x: \"a\" | \"b\") { return pipe(Match.value(x), Match.when(\"a\", () => \"A\"), Match.orElse((s) => `other ${s}`)) }",
		virtual: "import { Match } from \"effect\"; function phase(x: \"a\" | \"b\") { return $gen(function* () { return (yield* $run(pipe((yield* $run(Match.value(x))), Match.when(\"a\", () => \"A\"), Match.orElse((s) => `other ${s}`)))) })}"},

	{name: "unproven predicate retains narrowing syntax",
		source:  `import { maybe } from "./opaque.js"; function f() { if (maybe.isSome()) return maybe.value; return 0 }`,
		virtual: `import { maybe } from "./opaque.js"; function f() { return $gen(function* () { if ($dataGuard(maybe, "isSome", [], (yield* $run(maybe.isSome())))) return maybe.value; return 0 })}`},

	{name: "external service Effect member is a receiver preserving value call",
		source:  `import { Users } from "./users.ts"; function f() { return Users.all() }`,
		virtual: `import { Users } from "./users.js"; function f() { return $gen(function* () { return (yield* $run($member($use(Users), "all")())) })}`},
	{name: "a chained Config value call runs the returned data",
		source:  `function f() { return config("HOST")() }`,
		virtual: `function f() { return $gen(function* () { return (yield* $run($value((yield* $run(config("HOST"))))())) })}`},
	{name: "a pinned service alias contributes R in a tail only lambda",
		source:  `import { Path as Paths } from "effect/Path"; const f = (part: string) => Paths.join("root", part)`,
		virtual: `import { Path as Paths } from "effect/Path"; const f = (part: string) => $gen(function* () { return (yield* $run($use(Paths).join("root", part))) })`},
	{name: "L8 leaves an external key owned member on the key",
		source:  `import { Users } from "./users.ts"; function f() { return Users.pipe() }`,
		virtual: `import { Users } from "./users.js"; function f() { return $gen(function* () { return (yield* $run(Users.pipe())) })}`},

	{
		name:    "pipe topics use the data method module behind a local shadow",
		source:  "function f(xs: Stream.Stream<number>) { const Stream = 1; return xs |> %.map((n) => n + Stream) }",
		virtual: "function f(xs: Stream.Stream<number>) { return $gen(function* () { const Stream = 1; return (yield* $run($gen(function* () { const $topic = xs; return (yield* $run(Stream_1.map($topic, (n) => n + Stream))) }))) })}",
	},

	{name: "composed calls keep separate error channel witnesses", source: "function f() { return 1 |> % + 1 } function g() { return f() }", virtual: "function f() { return $gen(function* () { return (yield* $run($gen(function* () { const $topic = 1; return $topic + 1 }))) })} function g() { return $gen(function* () { return (yield* $runAt(f(), 57)) })}"},

	{
		name:    "stream topic method result metadata survives a chain",
		source:  "function f(xs: Stream.Stream<number>) { return xs.filter((n) => n > 0).map((n) => n + 1) }",
		virtual: "function f(xs: Stream.Stream<number>) { return $gen(function* () { return (yield* $run(Stream.map((yield* $run(Stream.filter(xs, (n) => n > 0))), (n) => n + 1))) })}",
	},
	{
		name:    "a held fork program joins through its declared module",
		source:  "function f() { const fiber = fork(() => 1); return fiber.join() }",
		virtual: "function f() { return $gen(function* () { const fiber = (yield* $run($scoped(fork)($gen(function* () { return 1 })))); return (yield* $run(Fiber.join(fiber))) })}",
	},

	{
		name:    "stored iterable programs convert at the collection boundary",
		source:  "function f(xs: Array<() => Effect.Effect<number>>) { return Effect.all(xs) }",
		virtual: "function f(xs: Array<() => Effect.Effect<number>>) { return $gen(function* () { return (yield* $run(Effect.all($programs(xs)))) })}",
	},
	{
		name:    "stored record fields adapt function values before holding calls cold",
		source:  "function f(job: () => Effect.Effect<number>) { return Effect.all({ a: job }) }",
		virtual: "function f(job: () => Effect.Effect<number>) { return $gen(function* () { return (yield* $run(Effect.all({ a: $asProgram(job) }))) })}",
	},
	{
		name:    "stored pipe programs and generic stages keep their forms",
		source:  "function f(job: () => Effect.Effect<number>) { return pipe(job, Effect.retry({ times: 2 })) }",
		virtual: "function f(job: () => Effect.Effect<number>) { return $gen(function* () { return (yield* $run(pipe($asProgram(job), Effect.retry({ times: 2 })))) })}",
	},
	{
		name:    "module runner takes a call by name",
		source:  "const n = Effect.runSync(Effect.succeed(1))",
		virtual: "const n = Effect.runSync($gen(function* () { return (yield* $run(Effect.succeed(1))) }))",
	},
	{
		name:    "pure module pipe evaluates once",
		source:  "const n = 21 |> % * 2",
		virtual: "const n = (() => { const $topic = 21; return $topic * 2 })()",
	},
	{
		name:    "program topic defers the input and retries the same program",
		source:  "function f() { return Effect.fail(1) |> Effect.retry(%, { times: 2 }) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($gen(function* () { const $topic = $gen(function* () { return (yield* $run(Effect.fail(1))) }); return (yield* $run(Effect.retry($topic, { times: 2 }))) }))) })}",
	},

	{
		name:    "a service keeps multiline empty channels around interleaved statics",
		source:  "export service Counter {\n increment(): void!!\n static readonly layer = Layer.succeed(Counter, { increment: () => {}, read: () => 2 })\n read(): number!!\n}",
		virtual: "export interface Counter {\n increment(): Effect.Effect<void, never, never>\n read(): Effect.Effect<number, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Counter\" } export abstract class Counter extends $service<Counter>(\"app/src/main#Counter\") { static readonly layer = Layer.succeed(Counter, { increment: () => { return $gen(function* () {})}, read: () => $gen(function* () { return 2 }) })\n \n}",
	},

	{
		name:    "using in a loop body keeps a statement block",
		source:  "function f(xs: string[]) { for (const x of xs) { using r = lease(x); if (x) continue\n return r }\n return \"end\" }",
		virtual: "function f(xs: string[]) { return $gen(function* () { for (const x of (yield* $each(xs))) { const $c = yield* $scopedBody($gen(function* () { const r = (yield* $acquire(lease(x))); if (x) return $jump(\"continue:\")\n return $box(r) })); if ($jumped($c, \"continue:\")) continue; return $unboxed($c) }\n return \"end\" })}",
	},

	{
		name:    "function scoped var escapes a region and a for initializer",
		source:  "function f() { try { var x = g(1); for (var i = 0; i < 2; i++) x += i } finally { h() }\n return x + i }",
		virtual: "function f() { return $gen(function* () {var x = $varType($gen(function* () { return (yield* $run(g(1))) })); var i = $varType($gen(function* () { return 0 }));  yield* $finally($gen(function* () {  x = (yield* $run(g(1))); for ( i = 0; i < 2; i++) x += i }), $gen(function* () { ;(yield* $run($value(h)())) }))\n return x + i })}",
	},

	{
		name:    "data method call punctuation skips comments",
		source:  "function f(o: Option.Option<number>) { return o.getOrElse /* ( */ (() => 0) }",
		virtual: "function f(o: Option.Option<number>) { return $gen(function* () { return (yield* $run(Option.getOrElse(o, () => 0))) })}",
	},

	{
		name:    "non-tail handle fallthrough has an undefined success",
		source:  "function f() { try { return Ask.answer() } handle Ask.answer() { const n = resume(1); log(n) } }",
		virtual: "function f() { return $gen(function* () { const $c = yield* handle_1($gen(function* () { return $box((yield* $run($member($use(Ask), \"answer\")()))) }) , Ask, { answer: ($k) => $gen(function* () { const n = (yield* $run(resume($k, 1))); ;(yield* $run(log(n))) ; return undefined; }) }); return $unboxed($c) })}",
	},
	{
		name:    "a never completing try has no void success path",
		source:  "function f() { try { throw 1 } finally { cleanup() } }",
		virtual: "function f() { return $gen(function* () { return yield* $finally($gen(function* () { return (yield* $fail(1)) as void }), $gen(function* () { ;(yield* $run($value(cleanup)())) })) })}",
	},

	{
		name:    "data predicate narrows the original receiver",
		source:  "function f(o: Option.Option<number>) { if (o.isSome()) return o.value; return 0 }",
		virtual: "function f(o: Option.Option<number>) { return $gen(function* () { if (Option.isSome(o)) return o.value; return 0 })}",
	},
	{
		name:    "module predicate retains stock narrowing",
		source:  "function f(e: Exit.Exit<number, string>) { return Exit.isFailure(e) ? e.cause : undefined }",
		virtual: "function f(e: Exit.Exit<number, string>) { return $gen(function* () { return Exit.isFailure(e) ? e.cause : undefined })}",
	},
	{
		name:    "data method uses the module behind a local shadow",
		source:  "function f(o: Option.Option<number>) { const Option = 1; return o.getOrElse(() => Option) }",
		virtual: "function f(o: Option.Option<number>) { return $gen(function* () { const Option = 1; return (yield* $run(Option_1.getOrElse(o, () => Option))) })}",
	},
	{
		name:    "join a held Fiber",
		source:  "function f(a: Fiber.Fiber<number>) { return join a }",
		virtual: "function f(a: Fiber.Fiber<number>) { return $gen(function* () { return (yield* $run($join(a))) })}",
	},
	{
		name:    "join an array of Fibers",
		source:  "function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { return join [a, b] }",
		virtual: "function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { return $gen(function* () { return (yield* $run($join([a, b]))) })}",
	},
	{
		name:    "join an object of Fibers",
		source:  "function f(a: Fiber.Fiber<number>) { return join { a } }",
		virtual: "function f(a: Fiber.Fiber<number>) { return $gen(function* () { return (yield* $run($join({ a }))) })}",
	},
	{
		name:    "join an annotated collection",
		source:  "function f(xs: Fiber.Fiber<number>[]) { return join xs }",
		virtual: "function f(xs: Fiber.Fiber<number>[]) { return $gen(function* () { return (yield* $run($join(xs))) })}",
	},
	{
		name:    "concurrent unbounded with continue",
		source:  "function f(xs: number[]) { for concurrent (const x of xs) { if (x) continue; } }",
		virtual: "function f(xs: number[]) { return $gen(function* () { ;(yield* $run($forConcurrent(xs, undefined, (x) => $gen(function* () { if (x) return; })))); })}",
	},
	{
		name:    "concurrent bounded single statement",
		source:  "function f(xs: number[]) { for concurrent(2) (const x of xs) log(x) }",
		virtual: "function f(xs: number[]) { return $gen(function* () { ;(yield* $run($forConcurrent(xs, 2, (x) => $gen(function* () { ;(yield* $run(log(x))) })))); })}",
	},
	{
		name:    "all takes its array elements by name",
		source:  "function f() { return all([Effect.succeed(1), Effect.succeed(2)]) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run(all([$gen(function* () { return (yield* $run(Effect.succeed(1))) }), $gen(function* () { return (yield* $run(Effect.succeed(2))) })]))) })}",
	},
	{
		name:    "library data call is evaluated lazily in a hatch",
		source:  "function f() { return sync(BigDecimal.fromNumberUnsafe(0)) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run(sync(() => (BigDecimal.fromNumberUnsafe(0))))) })}",
	},

	{
		name:    "cold data methods use module functions without running",
		source:  "const price = BigDecimal.make(875n, 2); const total = price.multiply(BigDecimal.fromBigInt(4n))",
		virtual: "const price = BigDecimal.make(875n, 2); const total = BigDecimal.multiply(price, BigDecimal.fromBigInt(4n))",
	},
	{
		name:    "hatch body retains plain JavaScript member semantics",
		source:  "function f() { return sync(() => BigDecimal.make(1n, 0).normalize()) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run(sync(() => BigDecimal.make(1n, 0).normalize()))) })}",
	},

	{
		name:    "hatch value is deferred and its inputs run",
		source:  "function f() { return sync(String(7)) + sync((n) => n * 2, read()) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run(sync(() => (String(7))))) + (yield* $run(sync((n) => n * 2, (yield* $run($value(read)()))))) })}",
	},
	{
		name:    "schema primitives optional literals arrays and readonly",
		source:  "export schema User { readonly id: string; home?: number; role: \"a\" | \"b\"; tags: string[]; mutable active: boolean }\n",
		virtual: "export interface User extends Schema.Schema.Type<typeof User> {}\nexport const User = Schema.Struct({ id: Schema.String, home: Schema.optional(Schema.Number), role: Schema.Literals([\"a\", \"b\"]), tags: Schema.mutable(Schema.Array(Schema.String)), active: Schema.mutableKey(Schema.Boolean) });\n",
	},
	{
		name:    "schema alias of a literal union (D280)",
		source:  "export schema Code = \"a\" | \"b\"\n",
		virtual: "export type Code = typeof Code.Type;\nexport const Code = Schema.Literals([\"a\", \"b\"]);\n",
	},
	{
		name:    "schema alias of other forms (D280)",
		source:  "schema Address { city: string }\nschema Home = Address | null;\nschema Pairs = ReadonlyArray<[string, number]>\nschema Point = { x: number }\n",
		virtual: "interface Address extends Schema.Schema.Type<typeof Address> {}\nconst Address = Schema.Struct({ city: Schema.String });\ntype Home = typeof Home.Type;\nconst Home = Schema.Union([Address, Schema.Null]);\ntype Pairs = typeof Pairs.Type;\nconst Pairs = Schema.Array(Schema.mutable(Schema.Tuple([Schema.String, Schema.Number])));\ntype Point = typeof Point.Type;\nconst Point = Schema.Struct({ x: Schema.Number });\n",
	},
	{
		name:    "schema nested reference",
		source:  "schema Address { city: string }\nschema User { home: Address; point: { x: number } }\n",
		virtual: "interface Address extends Schema.Schema.Type<typeof Address> {}\nconst Address = Schema.Struct({ city: Schema.String });\ninterface User extends Schema.Schema.Type<typeof User> {}\nconst User = Schema.Struct({ home: Address, point: Schema.Struct({ x: Schema.Number }) });\n",
	},
	{
		name:    "catch expression defers a value fallback (D236)",
		source:  "function f() { return a() catch 2 }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), () => $gen(function* () { return 2 })))) })}",
	},
	{
		name:    "catch expression contextually types a handler arrow (D238)",
		source:  "function f() { return a() catch (e) => recover(e) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), (e) => $gen(function* () { return (yield* $run(recover(e))) })))) })}",
	},
	{
		name:    "catch expressions associate to the left (D237)",
		source:  "function f() { return a() catch b() catch c }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), () => $gen(function* () { return (yield* $run($value(b)())) })))) }), () => $gen(function* () { return c })))) })}",
	},
	{
		name:    "nullish coalescing stays inside the catch (D237)",
		source:  "function f() { return a() ?? 1 catch 2 }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) ?? 1 }), () => $gen(function* () { return 2 })))) })}",
	},
	{
		name:    "catch expression stays in its conditional branch (D237)",
		source:  "function f(ok: boolean) { return ok ? a() catch 1 : 2 }",
		virtual: "function f(ok: boolean) { return $gen(function* () { return ok ? (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), () => $gen(function* () { return 1 })))) : 2 })}",
	},
	{
		name:    "catch in a pipe body captures its topic (D237)",
		source:  "declare function find(id: string): string!!; function f(id: string) { return id |> find(%) catch 1 }",
		virtual: "declare function find(id: string): Effect.Effect<string, never, never>; function f(id: string) { return $gen(function* () { return (yield* $run($gen(function* () { const $topic = id; return (yield* $run($catch($gen(function* () { return (yield* $run(find($topic))) }), () => $gen(function* () { return 1 })))) }))) })}",
	},
	{
		name:    "catch expression statement guards ASI",
		source:  "function f() {\n  a() catch 1\n}",
		virtual: "function f() { return $gen(function* () {\n  ;(yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), () => $gen(function* () { return 1 }))))\n})}",
	},
	{
		name:    "catch handler block runs its own Effect body",
		source:  "function f() { return a() catch e => { return recover(e) } }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catch($gen(function* () { return (yield* $run($value(a)())) }), e => { return $gen(function* () { return (yield* $run(recover(e))) })}))) })}",
	},
	{
		name:    "catch expression retains this in both operands",
		source:  "function f() { return this.a() catch this.b() }",
		virtual: "function f() { return $gen({ self: this }, function* () { return (yield* $run($catch($gen({ self: this }, function* () { return (yield* $run(this.a())) }), () => $gen({ self: this }, function* () { return (yield* $run(this.b())) })))) })}",
	},
	{
		name:    "a written catch helper call keeps ordinary call semantics",
		source:  "function f() { return $catchExpression(a, b) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($catchExpression(a, b))) })}",
	},
	{
		name:    "nested pipe bodies have distinct lexical topics",
		source:  "function f() { return 1 |> % + (2 |> % * 3) }",
		virtual: "function f() { return $gen(function* () { return (yield* $run($gen(function* () { const $topic = 1; return $topic + ((yield* $run($gen(function* () { const $topic_1 = 2; return $topic_1 * 3 })))) }))) })}",
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
		name:    "members are readonly unless mutable (D134)",
		source:  "interface Counter {\n  label: string\n  mutable count: number\n  [key: string]: unknown\n  tick(): void\n}\ntype P = { x: number; mutable y: number }\n",
		virtual: "interface Counter {\n  readonly label: string\n  count: number\n  readonly [key: string]: unknown\n  tick(): void\n}\ntype P = { readonly x: number; y: number }\n",
	},
	{
		name:    "a member named mutable stays",
		source:  "interface M { mutable: boolean }\n",
		virtual: "interface M { readonly mutable: boolean }\n",
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
		name:    "calls run in a function body",
		source:  "function greet(id: string) {\n  const user = find(id)\n  return user.name\n}\n",
		virtual: "function greet(id: string) { return $gen(function* () {\n  const user = (yield* $run(find(id)))\n  return user.name\n})}\n",
	},
	{
		name:    "nested and chained calls",
		source:  "function f(x: number) {\n  const y = f(g(x))\n  a(b)(c)\n  f().x\n}\n",
		virtual: "function f(x: number) { return $gen(function* () {\n  const y = (yield* $run(f((yield* $run(g(x))))))\n  ;(yield* $run((yield* $run(a(b)))(c)))\n  ;(yield* $run(f())).x\n})}\n",
	},
	{
		name:    "a run in an unbraced body takes no semicolon",
		source:  "function f(x: boolean) {\n  if (x) g(1)\n  else h(2)\n  while (x) g(3)\n  for (;;) h(4)\n}\n",
		virtual: "function f(x: boolean) { return $gen(function* () {\n  if (x) (yield* $run(g(1)))\n  else (yield* $run(h(2)))\n  while (x) (yield* $run(g(3)))\n  for (;;) (yield* $run(h(4)))\n})}\n",
	},
	{
		name:    "calls in a nested lambda stay",
		source:  "function f() {\n  return xs.map((x) => g(x))\n}\n",
		virtual: "function f() { return $gen(function* () {\n  return (yield* $run(xs.map((x) => g(x))))\n})}\n",
	},
	{
		name:    "a nested function declaration is its own Effect",
		source:  "function f() {\n  function inner() { return h(1) }\n  return inner\n}\n",
		virtual: "function f() { return $gen(function* () {\n  function inner() { return $gen(function* () { return (yield* $run(h(1))) })}\n  return inner\n})}\n",
	},
	{
		name:    "throw fails",
		source:  "function annotated(): User!NotFound! {\n  throw new NotFound({ id: f(1) })\n}\n",
		virtual: "function annotated(): Effect.Effect<User, NotFound, never> { return $gen(function* () {\n  return yield* $fail(new NotFound({ id: (yield* $run(f(1))) }))\n})}\n",
	},
	{
		name:    "a function that only throws keeps A void",
		source:  "function find(id: string) {\n  if (id === \"\") throw new Timeout()\n  throw new NotFound({ id })\n}\n",
		virtual: "function find(id: string) { return $gen(function* () {\n  if (id === \"\") return (yield* $fail(new Timeout())) as void\n  return (yield* $fail(new NotFound({ id }))) as void\n})}\n",
	},
	{
		name:    "an infer channel wraps the body in $contract (D57)",
		source:  "function find(id: string): string!infer E!Db {\n  return id\n}\n",
		virtual: "function find(id: string) { return $contract<string, $Infer, Db>()($gen(function* () {\n  return id\n}))}\n",
	},

	{
		name:    "written Effect contracts infer channels from the body (D57)",
		source:  "function f(): Effect<infer A, infer E, never> { return 1 }",
		virtual: "function f() { return $contract<$Infer, $Infer, never>()($gen(function* () { return 1 }))}",
	},
	{
		name:    "plain callbacks retain a contract success type (D67)",
		source:  "import { Schema } from \"effect\"; const s = Schema.suspend((): Effect<Schema.Codec<A, B>, never, never> => s)",
		virtual: "import { Schema } from \"effect\"; const s = Schema.suspend((): Schema.Codec<A, B> => s)",
	},

	{
		name:    "omitted dependencies of a contract are never (VIP-3)",
		source:  "function find(id: string): string!NotFound {\n  return id\n}\n",
		virtual: "function find(id: string): Effect.Effect<string, NotFound, never> { return $gen(function* () {\n  return id\n})}\n",
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
		name:    "top-level calls stay and an async function is TypeScript (VIP-1); a generator function is a producer (D26)",
		source:  "const top = f()\nasync function a() { return f() }\nfunction* g() { yield f() }\n",
		virtual: "const top = f()\nasync function a() { return f() }\nfunction g() { return $produce(function* () { yield $emit((yield* $run($value(f)()))) })}\n",
	},
	{
		name:    "a service is an interface and a key (D45)",
		source:  "export service Users {\n  find(id: string): User!NotFound\n  region: string\n}\n",
		virtual: "export interface Users {\n  find(id: string): Effect.Effect<User, NotFound, never>\n  readonly region: string; readonly \"~vibelang/service\"?: \"app/src/main#Users\" } export abstract class Users extends $service<Users>(\"app/src/main#Users\") {}\n",
	},
	{
		name:    "a control is a service whose base goes",
		source:  "control Approval { approve(request: string): boolean!! }\n",
		virtual: "interface Approval { approve(request: string): Effect.Effect<boolean, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Approval\" } abstract class Approval extends $service<Approval>(\"app/src/main#Approval\") {}\n",
	},
	{
		// D1/EK9205: all three contract channels are required on now.
		name:    "a D1 abstract class keeps its static members in the key",
		source:  "abstract class Clock extends Control {\n  abstract now(): Effect<number, never, never>;\n  static readonly zero = 0\n}\n",
		virtual: "interface Clock {\n  now(): Effect<number, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Clock\" } abstract class Clock extends $service<Clock>(\"app/src/main#Clock\") {\n  static readonly zero = 0\n}\n",
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
		source:  "export service Search: SearchApi {\n  static readonly layer = live\n}\nservice Prefix: string\nservice Format: (value: string) => string!!\n",
		virtual: "export interface Search { readonly \"~vibelang/service\"?: \"app/src/main#Search\" } export abstract class Search extends $service<Search, SearchApi>(\"app/src/main#Search\") {\n  static readonly layer = live\n}\ninterface Prefix { readonly \"~vibelang/service\"?: \"app/src/main#Prefix\" } abstract class Prefix extends $service<Prefix, string>(\"app/src/main#Prefix\") {}\ninterface Format { readonly \"~vibelang/service\"?: \"app/src/main#Format\" } abstract class Format extends $service<Format, (value: string) => Effect.Effect<string, never, never>>(\"app/src/main#Format\") {}\n",
	},
	{
		name:    "a service of any shape with a static default is a reference to its shape (D281, D40)",
		source:  "service Version: number { static readonly defaultValue = () => 4 }\n",
		virtual: "interface Version { readonly \"~vibelang/service\"?: \"app/src/main#Version\" } abstract class Version extends $reference<number>(\"app/src/main#Version\") { static readonly defaultValue = () => 4 }\n",
	},
	{
		name:    "methods of a class that implements a service are Effect functions (D92)",
		source:  "service Users { find(id: string): User!NotFound }\nclass Memory implements Users {\n  find(id: string) { return id }\n  static make() { return 1 }\n}\n",
		virtual: "interface Users { find(id: string): Effect.Effect<User, NotFound, never>; readonly \"~vibelang/service\"?: \"app/src/main#Users\" } abstract class Users extends $service<Users>(\"app/src/main#Users\") {}\nclass Memory implements Users {\n  find(id: string) { return $gen(function* () { return id })}\n  static make() { return 1 }\n}\n",
	},
	{
		name:    "a method takes the form its body decides",
		source:  "class Cache {\n  get(k: string) { return load(k) }\n  refresh(k: string) {\n    const v = load(k)\n    return v\n  }\n}\n",
		virtual: "class Cache {\n  get(k: string) { return load(k) }\n  refresh(k: string) { return $gen(function* () {\n    const v = (yield* $run(load(k)))\n    return v\n  })}\n}\n",
	},
	{
		name:    "returns leave a try statement through its completion",
		source:  "function f(id: string) {\n  try {\n    return find(id)\n  } catch (e) {\n    return \"guest\"\n  }\n}\n",
		virtual: "function f(id: string) { return $gen(function* () {\n  const $c = yield* $catch($gen(function* () {\n    return $box((yield* $run(find(id))))\n  }), (e) => $gen(function* () {\n    return $box(\"guest\")\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a region that no jump leaves dispatches nothing",
		source:  "function f() {\n  try {\n    g(1)\n  } catch {\n    g(2)\n  }\n}\n",
		virtual: "function f() { return $gen(function* () {\n  yield* $catch($gen(function* () {\n    ;(yield* $run(g(1)))\n  }), () => $gen(function* () {\n    ;(yield* $run(g(2)))\n  }))\n})}\n",
	},
	{
		name:    "a break that leaves a region is a jump the loop takes",
		source:  "function g(xs: number[]) {\n  for (const x of xs) {\n    try {\n      if (x) break\n      g(x)\n    } finally {\n      h(x)\n    }\n  }\n}\n",
		virtual: "function g(xs: number[]) { return $gen(function* () {\n  for (const x of (yield* $each(xs))) {\n    const $c = yield* $finally($gen(function* () {\n      if (x) return $jump(\"break:\")\n      ;(yield* $run(g(x)))\n    ; return $end }), $gen(function* () {\n      ;(yield* $run(h(x)))\n    ; return $end })); if ($jumped($c, \"break:\")) break\n  }\n})}\n",
	},
	{
		name:    "a jump that leaves two regions passes the completion on",
		source:  "function f() {\n  try {\n    try {\n      return 1\n    } finally {\n      g(1)\n    }\n  } catch {\n    return 2\n  }\n}\n",
		virtual: "function f() { return $gen(function* () {\n  const $c = yield* $catch($gen(function* () {\n    const $c_1 = yield* $finally($gen(function* () {\n      return $box(1)\n    }), $gen(function* () {\n      ;(yield* $run(g(1)))\n    ; return $end })); return $c_1\n  }), () => $gen(function* () {\n    return $box(2)\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a provide block provides its layers to a region (D172, D173)",
		source:  "function main() {\n  provide AppLive, Clock = clock {\n    return greet(\"42\")\n  }\n}\n",
		virtual: "function main() { return $gen(function* () {\n  const $c = yield* $provideEntries([AppLive, $provideService(Clock, \"Clock\", clock)])($gen(function* () {\n    return $box((yield* $run(greet(\"42\"))))\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a handle statement runs its block under handle (D132)",
		source:  "function k(version: string) {\n  try {\n    return release(version)\n  } handle Approval.approve(request) {\n    log(request)\n    resume(true)\n  }\n}\n",
		virtual: "function k(version: string) { return $gen(function* () {\n  const $c = yield* handle_1($gen(function* () {\n    return $box((yield* $run(release(version))))\n  }) , Approval, { approve: (request, $k) => $gen(function* () {\n    ;(yield* $run(log(request)))\n    return $tailResume($k, true)\n  }) }); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a match expression in an Effect body runs as a program (D206)",
		source:  "function f(e: Failure) {\n  const label = match (e) {\n    when NotFound and { let id }: `no user ${id}`;\n    default: describe(e);\n  }\n  return label\n}\n",
		virtual: "function f(e: Failure) { return $gen(function* () {\n  const label = (yield* $run($gen(function* () { void e; { if ($is(NotFound, e) && (typeof e === \"function\" || typeof e === \"object\") && e !== null && \"id\" in e) { let id = e.id; return `no user ${id}`; } } return (yield* $run(describe(e))); })))\n  return label\n})}\n",
	},
	{
		name:    "a returned match returns from its arms, exhaustively (D209)",
		source:  "function g(o: Option.Option<number>) {\n  return match (o) {\n    when Option.Some(let v): v;\n    when Option.None: 0;\n  }\n}\n",
		virtual: "function g(o: Option.Option<number>) { return $gen(function* () {\n  { void o; { if (Option.isSome(o)) { let v = o.value; return v; } } { if (Option.isNone(o)) { return 0; } } return $noMatch(o); }\n})}\n",
	},
	{
		name:    "a match statement and an is test",
		source:  "function h(n: number) {\n  match (n) {\n    when 1: log(\"one\");\n    default: log(\"other\");\n  }\n  return n is 1 or 2\n}\n",
		virtual: "function h(n: number) { return $gen(function* () {\n  $match2: { void n; { if (n === 1) { (yield* $run(log(\"one\"))); break $match2; } } (yield* $run(log(\"other\"))); break $match2; } \n  return (((n === 1) || (n === 2)))\n})}\n",
	},
	{
		name:    "using acquires its initializer by name in the block's Scope (D47, D14)",
		source:  "function report(path: string) {\n  using file = Files.open(path)\n  using t = timer(\"x\")\n  return file.name\n}\n",
		virtual: "function report(path: string) { return $gen(function* () {\n  const file = (yield* $acquire($use(Files).open(path)))\n  const t = (yield* $acquire(timer(\"x\")))\n  return file.name\n})}\n",
	},
	{
		name:    "interruption blocks and finally (exit) are regions (D178-D180)",
		source:  "function f() {\n  uninterruptible {\n    const conn = acquire()\n    try { restore { return use(conn) } } finally (exit) { release(conn, exit) }\n  }\n}\n",
		virtual: "function f() { return $gen(function* () {\n  const $c = yield* uninterruptible($gen(function* () {\n    const conn = (yield* $run($value(acquire)()))\n    const $c_1 = yield* $finallyExit($gen(function* () { const $c_2 = yield* restore($gen(function* () { return $box((yield* $run(use(conn)))) })); return $c_2 }), (exit) => $gen(function* () { ;(yield* $run(release(conn, exit))) ; return $end })); return $c_1\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a tail region falls off its end for TypeScript's reachability",
		source:  "function describe(e: Failure) {\n  try {\n    return find(e)\n  } catch (error) {\n    switch (error._tag) {\n      case \"A\": return \"a\"\n      case \"B\": return \"b\"\n    }\n  }\n}\n",
		virtual: "function describe(e: Failure) { return $gen(function* () {\n  const $c = yield* $catch($gen(function* () {\n    return $box((yield* $run(find(e))))\n  }), (error) => $gen(function* () {\n    switch (error._tag) {\n      case \"A\": return $box(\"a\")\n      case \"B\": return $box(\"b\")\n    }\n  })); return $unboxed($c)\n})}\n",
	},
	{
		name:    "a producer is a Stream that emits its yields (D26)",
		source:  "function* lookups(keys: string[]) {\n  for (const key of keys) yield Store.get(key)\n  yield* more()\n}\nfunction total() {\n  let sum = 0\n  for (const n of lookups([\"a\"])) sum += n\n  return sum\n}\n",
		virtual: "function lookups(keys: string[]) { return $produce(function* () {\n  for (const key of (yield* $each(keys))) yield $emit((yield* $run($use(Store).get(key))))\n  yield* $delegate((yield* $run($value(more)())))\n})}\nfunction total() { return $gen(function* () {\n  let sum = 0\n  for (const n of (yield* $each((yield* $run(lookups([\"a\"])))))) sum += n\n  return sum\n})}\n",
	},
	{
		name:    "a layer without statements succeeds with its members",
		source:  "layer UsersLive: Users {\n  find(id) { return lookup(id) }\n  readonly region = \"eu\";\n}\n",
		virtual: "const UsersLive = Layer.succeed(Users, {\n  find(id) { return $gen(function* () { return (yield* $run(lookup(id))) })},\n  region: \"eu\"\n})\n",
	},
	{
		name:    "a layer with statements builds in an Effect",
		source:  "export layer UsersLive: Users {\n  const d = Directory()\n  find(id) { return d.lookup(id) }\n  readonly region = name()\n}\n",
		virtual: "export const UsersLive = Layer.effect(Users, $gen(function* () {\n  const d = (yield* $run($value(Directory)()))\n  return { find(id) { return $gen(function* () { return (yield* $run(d.lookup(id))) })},\n  region: (yield* $run($value(name)())) }\n}))\n",
	},
	{
		name:    "service member calls read the service (D41)",
		source:  "function f(id: string) {\n  return Users.find(id)\n}\n",
		virtual: "function f(id: string) { return $gen(function* () {\n  return (yield* $run($use(Users).find(id)))\n})}\n",
	},
	{
		name:    "effect modules and JavaScript globals are not keys",
		source:  "function f() {\n  Console.log(Math.max(1, 2))\n}\n",
		virtual: "function f() { return $gen(function* () {\n  ;(yield* $run(Console.log((yield* $run(Math.max(1, 2))))))\n})}\n",
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
		assert.Equal(t, projection.Diagnostics[0].Code, int32(1001))
		assertParses(t, projection.Text)
	}
}

// TestCatchExpressionCorpus checks synthesized match and do operands in
// the runnable fixture, including its throw handler and lazy fallback.
func TestCatchExpressionCorpus(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../../vibelang/cases/catch-expression/main.vibe")
	assert.NilError(t, err)
	source := string(data)
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assertValidMap(t, projection, source)
	assert.Assert(t, strings.Contains(projection.Text, "$run(exit($gen("), "exit must receive its catch operand by name:\n%s", projection.Text)
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "exit($gen("), "exit must capture the catch operand's defect:\n%s", js)
}

// TestPipeTopicChoices checks that D155 program topics and opaque callees
// cannot silently choose an evaluation boundary for an opaque or mixed topic.
func TestPipeTopicChoices(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"import { opaque } from './other'; function f() { return pipe(() => a(), opaque) }",
		"function f() { return a() |> retry(%, Schedule.recurs(2)) + % }",
		"import { opaque } from './other'; function f() { return a() |> opaque(%) catch 1 }",
	} {
		projection := Project(source, testContext)
		assert.Assert(t, len(projection.Diagnostics) > 0, "%s", source)
		for _, d := range projection.Diagnostics {
			assert.Equal(t, d.Code, int32(CodeFormChoice), "%v", d)
		}
	}
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
	source := "const Option = 1\nfunction f() {\n  const $run = 2\n  Console.log(Option)\n}\nconst L = Layer.empty\n"
	projection := Project(source, testContext)
	line, _, _ := strings.Cut(projection.Text, "\n")
	assert.Equal(t, line, `import { type $PreludeLoaded, $gen, $run as $run_1, Console, Layer } from "vibelang-ts-mapper/prelude"; true satisfies $PreludeLoaded;`)
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
	assert.Equal(t, rest, "import { Effect } from \"effect\"\ntype A = Effect_1<string, never, never>\nconst x = Effect.void\nfunction f<Scope>(s: Scope) { return $gen(function* () {})}\n")
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

// TestFormChoice checks that a lambda whose form the rules cannot decide
// draws EK9100 at the lambda, with the resolver's message, and still lowers
// the default's guess.
func TestFormChoice(t *testing.T) {
	t.Parallel()
	source := "function f(xs: Items) {\n  xs.forEach((x) => {\n    log(x)\n    g(x)\n  })\n}\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 1)
	d := projection.Diagnostics[0]
	assert.Equal(t, d.Code, int32(CodeFormChoice))
	assert.Equal(t, source[d.Start:d.Start+d.Length], "(x) => {\n    log(x)\n    g(x)\n  }")
	assert.Assert(t, strings.HasPrefix(d.Message, "Cannot tell whether the lambda at argument 1 of xs.forEach is a plain function or an Effect function"), d.Message)
	assert.Assert(t, strings.Contains(projection.Text, "(x) => { return $gen(function* () {"), projection.Text)
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
// rendering: a service's base, a control's registration, which only the
// executable rendering writes, and a block that is a Scope region of its own.
func TestExecutableEdits(t *testing.T) {
	t.Parallel()
	source := "control Approval { approve(request: string, ...notes: string[]): boolean!! }\nservice Flags { readonly beta: boolean; static readonly defaultValue = () => ({ beta: true }) }\nfunction f() {\n  g(1)\n  {\n    using r = acquire()\n  }\n}\n"
	p := lower(source, testContext)
	var bases, controls [][]string
	scopes := 0
	for _, e := range p.plan.edits {
		switch e.kind {
		case editServiceBase:
			bases = append(bases, e.fields)
		case editControl:
			controls = append(controls, e.fields)
		case editScopeRegion:
			if e.part == partOpen {
				assert.Equal(t, source[e.pos], byte('{'))
			} else {
				assert.Equal(t, source[e.pos-1], byte('}'))
			}
			scopes++
		}
	}
	assert.DeepEqual(t, bases, [][]string{{"service", "app/src/main#Approval", "Approval"}, {"reference", "app/src/main#Flags", "Flags"}})
	assert.DeepEqual(t, controls, [][]string{{"Approval", "approve", "-1"}})
	assert.Equal(t, scopes, 2) // the inner block's open and close, not the function body's
}

// TestExecutableServiceShape checks that the executable rendering of a
// service of any shape (D281) writes its key around the shape, and passes a
// static default as a reference's.
func TestExecutableServiceShape(t *testing.T) {
	t.Parallel()
	source := "service Prefix: string\nservice Version: number { static readonly defaultValue = () => 4 }\n"
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
		"/repo/node_modules/effect/package.json":         `{"version": "4.1.0"}`,
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
	assert.Assert(t, strings.Contains(message, "effect 4.1.0 (the table pins 4.0.6)"), message)
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
	assert.Equal(t, virtualBody(t, unsupported), "interface Event extends Schema.Schema.Type<typeof Event> {}\nconst Event = Schema.Struct({ run: Schema.Unknown, parts: Schema.Unknown });\n")
	assert.Equal(t, len(unsupported.Diagnostics), 2)

	for _, source := range []string{
		"schema Event { when: Date; run(): void; parts: Partial<{ a: string }> }",
		"type Alias = string; schema Event { value: Alias }",
		"import type { Remote } from './remote'; schema Event { value: Remote }",
		"schema Run = () => void",
		"schema When = Date",
	} {
		projection := Project(source, testContext)
		assert.Assert(t, len(projection.Diagnostics) > 0, source)
		for _, diagnostic := range projection.Diagnostics {
			assert.Equal(t, diagnostic.Code, int32(2109))
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
	assert.Assert(t, strings.HasSuffix(projection.Text, "export const Draft = Schema.Struct({ title: Schema.mutableKey(Schema.String), tags: Schema.optional(Schema.Array(Schema.String)), pair: Schema.Tuple([Schema.Number, Schema.String]), counts: Schema.Record(Schema.String, Schema.mutableKey(Schema.Number)) });\n"), projection.Text)
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
		{"unknown join", "function f(x: unknown) { return join x }", CodeFormChoice},
		{"unannotated parameter", "function f(x) { return join x }", CodeFormChoice},
		{"unknown call result", "function f() { return join external() }", CodeFormChoice},
		{"nonfiber", "function f() { const x = 1; return join x }", 4611},
		{"empty object", "function f() { return join {} }", 4611},
		{"nested join", "function f(a: Fiber.Fiber<number>) { return join [[a]] }", 4611},
		{"nested annotated join", "function f(a: Fiber.Fiber<number>[][]) { return join a }", 4611},
		{"Deferred", "function f(a: Deferred.Deferred<number>) { return join a }", 4611},
		{"break", "function f() { for concurrent (const x of [1]) { break } }", 4605},
		{"return", "function f() { for concurrent (const x of [1]) { return x } }", 4606},
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
	source := "function f(xs: number[]) { if (xs.length) for concurrent(2) (const x of xs) { for (let i = 0; i < 2; i++) { if (i) break; continue } const g = () => { return x }; if (x) continue; log(x) } }"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "if (xs.length) (yield*"), "%s", projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "break; continue"), "%s", projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "if (x) return;"), "%s", projection.Text)
}

// TestConcurrentContinueRegions checks item exits through a lazy region
// and a parser-generated single-statement block, where edits share a span.
func TestConcurrentContinueRegions(t *testing.T) {
	for _, source := range []string{
		"function f(xs: number[]) { for concurrent (const x of xs) continue }",
		"function f(xs: number[]) { for concurrent (const x of xs) { try { if (x) continue } finally { log(x) } } }",
		"function f(xs: number[]) { for concurrent (const x of xs) { for concurrent (const y of xs) { if (y) continue } if (x) continue } }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assertParses(t, projection.Text)
		assert.Assert(t, !strings.Contains(virtualBody(t, projection), "continue"), "%s", projection.Text)
	}
}

// TestJoinAnnotatedFactory uses a function's written value channel after
// its Effect runs, while a held Effect itself remains an invalid join leaf.
func TestJoinAnnotatedFactory(t *testing.T) {
	source := "declare function make(): Fiber.Fiber<number>!!; function f() { return join make() }"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assertParses(t, projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "$join((yield* $run(make())))"), "%s", projection.Text)
}

// TestFiberFormsInSynthesizedExpressions keeps fiber operations in do and
// match bodies on their own lowering path, including their run edits.
func TestFiberFormsInSynthesizedExpressions(t *testing.T) {
	for _, source := range []string{
		"function f(a: Fiber.Fiber<number>) { return do { join a } }",
		"function f(a: Fiber.Fiber<number>) { return match (1) { when 1: join a; default: 0; } }",
		"function f() { return do { for concurrent (const x of [1]) { log(x) } 1 } }",
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
		assertParses(t, projection.Text)
		want := "$run($join("
		if strings.Contains(source, "for concurrent") {
			want = "$run($forConcurrent("
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

// TestRegionVarNeedsAnnotation keeps lexical dependencies and repeated
// declarations from acquiring a type from the wrong generator's scope.
func TestRegionVarNeedsAnnotation(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"function f() { try { const n = 1; var x = n } finally {} return x }",
		"const e = 0; function f() { try { g() } catch (e) { var x = e } return x }",
		"const n = 0; function f() { try { const { n } = read(); var x = n } finally {} return x }",
		"const n = 0; function f() { for (let n = 0; n < 2; n++) { try { var x = n } finally {} } return x }",
		"function f() { try { var x = 1; var x = 2 } finally {} return x }",
		"function f() { try { var { x } = read() } finally {} return x }",
	} {
		p := Project(source, testContext)
		assert.Assert(t, len(p.Diagnostics) > 0, "%s", source)
		assert.Assert(t, strings.Contains(p.Diagnostics[0].Message, "Annotate"), "%v", p.Diagnostics)
	}
}

// TestDoControlFlow pins diagnostics in original coordinates while allowing
// local targets and nested functions, whose returns do not leave the do block.
func TestDoControlFlow(t *testing.T) {
	for _, c := range []struct {
		source, keyword string
		code            int32
	}{
		{"function f() { return do { return 1; 2 } }", "return 1", 1108},
		{"function f() { while (true) { const x = do { break; 1 } } }", "break", 1107},
		{"function f() { outer: while (true) { const x = do { continue outer; 1 } } }", "continue outer", 1107},
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
		message := "Jump target cannot cross function boundary."
		if c.code == 1108 {
			message = "A 'return' statement can only be used within a function body."
		}
		assert.Equal(t, d.Message, message)
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
	// D229/EK4405: the parameter is outside sync's first argument, just as
	// native checkHatches -> outsideReferences -> declaredOutside decides.
	// Keep this invalid input to also test the original callable-value ambiguity.
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		assert.Equal(t, len(projection.Diagnostics), 2, "%v", projection.Diagnostics)
		codes := map[int32]bool{}
		for _, diagnostic := range projection.Diagnostics {
			codes[diagnostic.Code] = true
			if diagnostic.Code == 4405 {
				assert.Equal(t, diagnostic.Start, strings.LastIndex(source, "BigDecimal"))
				assert.Equal(t, diagnostic.Length, len("BigDecimal"))
				assert.Equal(t, diagnostic.Message, "BigDecimal is declared outside the hatch, and a hatch's TypeScript is self-contained: pass BigDecimal to sync as an input.")
			}
		}
		assert.Assert(t, codes[CodeUnprojectedForm] && codes[4405], "%v", projection.Diagnostics)
	}
}
