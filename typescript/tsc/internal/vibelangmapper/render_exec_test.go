package vibelangmapper

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"gotest.tools/v3/assert"
)

// TestRenderExec checks each kind's default executable text, with helper
// references unresolved: the kinds whose text is the same in both
// renderings, and those whose run-time form differs.
func TestRenderExec(t *testing.T) {
	t.Parallel()
	tmp, run, s := helperRef("$t"), helperRef("$isRun"), helperRef("$s")
	render := func(kind editKind, arg string, inner string) string {
		var out strings.Builder
		for _, p := range []part{partOpen, partClose} {
			text, keep := renderExec(edit{kind: kind, part: p, arg: arg})
			assert.Assert(t, keep)
			out.WriteString(text)
			if p == partOpen {
				out.WriteString(inner)
			}
		}
		return out.String()
	}
	assert.Equal(t, render(editRun, "", "f(x)"), "(("+tmp+" = f(x)), "+run+"("+tmp+") ? (yield* "+tmp+") : "+tmp+")")
	assert.Equal(t, render(editServiceCall, "", "Users"), "(("+s+" = Users), "+helperRef("$isKey")+"("+s+") ? (yield* "+s+") : "+s+")")
	assert.Equal(t, render(editValueCall, "", "Config"), helperRef("$value")+"(Config)")
	assert.Equal(t, render(editFail, "void", "e"), "return (yield* "+helperRef("$fail")+"(e))")
	assert.Equal(t, render(editRecord, "return value", "x"), "return x")
	assert.Equal(t, render(editUsing, "", "lease()"), "(yield* "+helperRef("$acquire")+"("+helperRef("$scope")+", lease()))")
	assert.Equal(t, render(editEffectBody, "self", " body "), " return "+helperRef("$gen")+"({ self: this }, function* () { body })")
	text, keep := renderExec(edit{kind: editSyntax, text: "abstract class"})
	assert.Assert(t, keep && text == "abstract class")
	_, keep = renderExec(edit{kind: editWitness, text: ", g(x)"})
	assert.Assert(t, !keep)
}

// emitCases are the executable rendering's rules: a source, text its
// JavaScript must contain, and text it must not.
var emitCases = []struct {
	name     string
	source   string
	contains []string
	absent   []string
}{
	{
		name:     "iterator-annotated generators retain native execution (D271)",
		source:   "function* steps(): Generator<number, number, unknown> { try { yield f(); return 9 } catch { yield 3; return 0 } }",
		contains: []string{"function* steps()", "yield f()", "catch"},
		absent:   []string{"$produce(", "$emit(", "$fail(", "$caught("},
	},

	{name: "unproven data method dispatches with receiver and arguments",
		source:   `import { maybe } from "./opaque.js"; function f() { return maybe.getOrElse((): number => 0) }`,
		contains: []string{`$method(maybe, "getOrElse", [() => 0], $methodCandidates_getOrElse)`},
		absent:   []string{`maybe.getOrElse(`}},

	{name: "service value calls bind ordinary methods and evaluate the receiver once",
		source:   `import { Users } from "./users.ts"; function f() { return Users.all() }`,
		contains: []string{`$member((($s = Users), $isKey($s) && !("all" in $s) ? (yield* $s) : $s), "all")()`, `const v = self[key]`, `v.bind(self)`},
		absent:   []string{`.all()`}},
	{name: "chained Config value calls adapt the result before invoking it",
		source:   `function f() { return config("HOST")() }`,
		contains: []string{`$value((($t = config("HOST")), $isRun($t) ? (yield* $t) : $t))()`}},
	{name: "pinned service tail lambda has an Effect boundary",
		source:   `import { Path as Paths } from "effect/Path"; const f = (part: string) => Paths.join("root", part)`,
		contains: []string{`(part) => $gen(function* ()`, `(($s = Paths), $isKey($s) && !("join" in $s) ? (yield* $s) : $s).join("root", part)`}},
	{name: "a tagged error value call replays through a generator",
		source:   `function f(error: Cause.YieldableError) { return error() }`,
		contains: []string{`$value(error)()`, `function* () { return yield* v`}},

	{
		name:     "interleaved static service retains its key and erased instance shape",
		source:   "export service Counter { increment(): void!!\n static readonly layer = Layer.succeed(Counter, { increment: () => {}, read: () => 2 })\n read(): number!!\n}",
		contains: []string{`class Counter extends $service("app/src/main#Counter")`, `static layer = Layer.succeed(Counter`},
		absent:   []string{"abstract read", "interface Counter", "number!!"},
	},
	{
		name:     "region var storage escapes while its initializer runs at its source site",
		source:   "function f() { try { var x = g(1); for (var i = 0; i < 2; i++) x += i } finally { h() }\n return x + i }",
		contains: []string{"var x;", "var i;", "x = (($t = g(1))", "return x + i"},
		absent:   []string{"$varType", "var x =", "var i ="},
	},
	{
		name:     "using region in loop retains per iteration scope and jump dispatch",
		source:   "function f() { for (let i = 0; i < 3; i++) { using r = lease(i)\n if (i) continue\n return r }\n return 0 }",
		contains: []string{"for (let i = 0; i < 3; i++) {", "$region(($scope)", `$jump("continue:")`, "continue;"},
		absent:   []string{"$scopedBody", "using r"},
	},

	{
		name:     "resume expressions hide normal and jump sentinels while retaining pending completion",
		source:   "control Ask { answer(): number!! } function f() { try { Ask.answer() } handle Ask.answer() { const value = resume(1); record(value) } }",
		contains: []string{"$returned($pending) ? $pending : undefined", "return $pending"},
	},

	{
		name:     "data methods and predicates call the module without prototypes",
		source:   "function f(o: Option.Option<number>) { if (o.isSome()) return o.getOrElse(() => 0); return 0 }",
		contains: []string{"Option.isSome(o)", "Option.getOrElse(o, () => 0)"},
		absent:   []string{"o.isSome()", "o.getOrElse("},
	},
	{
		name:     "async sync hatch binds inputs before the AbortSignal",
		source:   "function f() { return sync(async (n, signal) => signal.aborted ? 0 : n, read()) }",
		contains: []string{"$promise($evaluate.bind(undefined, ...$inputs))", "async (n, signal) => signal.aborted ? 0 : n", "$value(read)()"},
		absent:   []string{"yield* signal", "sync(async"},
	},
	{
		name:     "library data call stays lazy plain TypeScript",
		source:   "function f() { return sync(BigDecimal.fromNumberUnsafe(0)) }",
		contains: []string{"sync(() => (BigDecimal.fromNumberUnsafe(0)))"},
		absent:   []string{"$value(BigDecimal", "yield* BigDecimal"},
	},

	{
		name:     "composed call channel witnesses never execute",
		source:   "function f() { return 1 |> % + 1 } function g() { return f() }",
		contains: []string{"f$fast()"},
		absent:   []string{"$runAt", "$yieldSite"},
	},

	{
		name:     "stored collections convert functions without running them early",
		source:   "function f(xs: Array<() => Effect.Effect<number>>) { return Effect.all(xs) }",
		contains: []string{"Effect.all($programs(xs))", "Array.from(xs, $asProgram)", "$suspend(() => { const result = v();"},
		absent:   []string{"f$direct"},
	},
	{
		name:     "pipe program inputs and generic stages share the checking boundary",
		source:   "function f(job: () => Effect.Effect<number>) { return pipe(job, Effect.retry({ times: 2 })) }",
		contains: []string{"pipe($asProgram(job), Effect.retry({ times: 2 }))"},
	},
	{
		name:     "by name topic is a cold generator and module value pipes stay plain",
		source:   "const n = 21 |> % * 2; function f() { return Effect.fail(1) |> Effect.retry(%, { times: 2 }) }",
		contains: []string{"const $topic = 21", "const $topic_1 = $gen(function* ()", "Effect.retry($topic_1, { times: 2 })"},
		absent:   []string{"|>", "(%)"},
	},
	{
		name:     "known stream chains use module functions in both renderings",
		source:   "function f(xs: Stream.Stream<number>) { return xs.filter((n) => n > 0).map((n) => n + 1) }",
		contains: []string{"Stream.map(", "Stream.filter(xs, (n) => n > 0)"},
		absent:   []string{".filter((n)", ".map((n)"},
	},
	{
		name:     "acyclic entries forward defaults rest and destructuring once",
		source:   "function f(a = seed(), { x } = object(), [y] = array(), ...rest: number[]) { return unknown(a, x, y, rest) }",
		contains: []string{"function f$fast(a, $arg1, $arg2, ...rest)", "f$body(a, $arg1, $arg2, ...rest)", "function* f$body(a = seed(), { x } = object(), [y] = array(), ...rest)"},
		absent:   []string{"const f$fast", "$fast(f$body)"},
	},
	{
		name:     "a body that reads arguments keeps the counted entry, which forwards every argument",
		source:   "function f(a: number) { return unknown(arguments.length, () => arguments[1]) }",
		contains: []string{"const f$fast = $fast(f$body);"},
		absent:   []string{"function f$fast("},
	},
	{
		name:     "arguments of a nested function don't count",
		source:   "function f(a: number) { return unknown(function () { return arguments.length }) }",
		contains: []string{"function f$fast(a)"},
		absent:   []string{"const f$fast"},
	},
	{
		name:     "direct recursion counts eager depth",
		source:   "function f(n: number) { unknown(); return n ? f(n - 1) : 0 }",
		contains: []string{"const f$fast = $fast(f$body);", "f$fast(n - 1)"},
	},
	{
		name:     "mutual recursion counts only cycle members",
		source:   "function f(n: number) { return n ? g(n - 1) : unknown() } function g(n: number) { return f(n) } function outer(n: number) { return f(n) }",
		contains: []string{"const f$fast = $fast(f$body);", "const g$fast = $fast(g$body);", "function outer$fast(n)"},
		absent:   []string{"const outer$fast"},
	},
	{
		name:     "recursion through a lambda starts on the fiber",
		source:   "function f(n: number) { return unknown(() => f(n - 1)) }",
		contains: []string{"function f$fast(n)", "f$fast(n - 1)"},
		absent:   []string{"const f$fast"},
	},
	{
		name:     "export specifiers do not shadow a pure declaration",
		source:   "function f(n: number) { return n * 3 } export { f }; function g() { return f(2) }",
		contains: []string{"function f$direct(n)", "f[$direct] = f$direct;", "return f$direct(2);", "export { f };"},
		absent:   []string{"f$fast"},
	},
	{
		name:     "fiber forms in do bodies retain executable run boundaries",
		source:   "function f(a: Fiber.Fiber<number>) { return do { join a } } function g() { return do { for concurrent (const x of [1]) { log(x) } 1 } }",
		contains: []string{"$join(a)", "$forConcurrent([1], undefined, (x) => $gen(function* ()", "$isRun($t) ? (yield* $t) : $t"},
		absent:   []string{"for concurrent", "join a", "f$direct", "g$direct"},
	},
	{
		name:     "join runs a held fiber and keeps array and object shapes",
		source:   "function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { const x = join a; const y = join [a, b]; return join { a, b } }",
		contains: []string{"$join(a)", "$join([a, b])", "$join({ a, b })", "$isRun($t) ? (yield* $t) : $t"},
		absent:   []string{"join a", "f$direct", "$asProgram(a)"},
	},
	{
		name:     "concurrent loops defer bodies and continue returns from one item",
		source:   "function f(xs: number[]) { for concurrent(2) (const x of xs) { if (!x) continue; log(x) } for concurrent (const x of xs) log(x) }",
		contains: []string{"$forConcurrent(xs, 2, (x) => $gen(function* ()", "$forConcurrent(xs, undefined, (x) => $gen(function* ()", "return;", "log(x)"},
		absent:   []string{"for concurrent", "continue", "f$direct"},
	},
	{
		name:     "all receives programs instead of completed strings",
		source:   "function f() { return all([Effect.succeed(1), Effect.succeed(2)]) }",
		contains: []string{"all([$gen(function* ()", "Effect.succeed(1)", "Effect.succeed(2)"},
		absent:   []string{"f$direct"},
	},
	{
		name:   "catch expressions run operands inside lazy generators",
		source: "function f() { return a() catch e => recover(e) }",
		contains: []string{
			`import { $catch, $done, $isRun, $settle } from "vibelang-runtime";`,
			"$catch($gen(function* () { return (($t = $value(a)()), $isRun($t) ? (yield* $t) : $t); }), e => $gen(function* () { return (($t = recover(e)), $isRun($t) ? (yield* $t) : $t); }))",
		},
		absent: []string{"$catchExpression", "f$direct"},
	},
	{
		name:   "a catch fallback in a pipe keeps the evaluated topic",
		source: "declare function input(): string!!; declare function find(id: string): string!!; declare function backup(id: string): string!!; function f() { return input() |> find(%) catch backup(%) }",
		contains: []string{
			"const $topic = (($t = input()), $isRun($t) ? (yield* $t) : $t);",
			"$catch($gen(function* () { return (($t = find($topic)), $isRun($t) ? (yield* $t) : $t); }), () => $gen(function* () { return (($t = backup($topic)), $isRun($t) ? (yield* $t) : $t); }))",
		},
		absent: []string{"|>", "(%)", "f$direct"},
	},
	{
		name:   "a pure function splits into f$direct and its Effect wrapper (D10)",
		source: "export function double(n: number) {\n  return n * 2\n}\n",
		contains: []string{
			"export function double(...$args) { return $plainSync(double$direct, this, $args); }",
			"double[$direct] = double$direct;",
			"function double$direct(n) {\n    return n * 2;\n}",
			`import { $direct, $plainSync } from "vibelang-runtime";`,
		},
		absent: []string{"export function double$direct", "$isRun", "sync as $sync"},
	},
	{
		name:   "a same-file pure call is direct, and pure groups recurse on the JavaScript stack",
		source: "function even(n: number) {\n  return n === 0 ? true : odd(n - 1)\n}\nfunction odd(n: number) {\n  return n === 0 ? false : even(n - 1)\n}\nfunction f(n: number) {\n  return even(n) && Math.max(n, 2) > 1\n}\n",
		contains: []string{
			"return n === 0 ? true : odd$direct(n - 1);",
			"return n === 0 ? false : even$direct(n - 1);",
			"return even$direct(n) && Math.max(n, 2) > 1;",
		},
		absent: []string{"$isRun", "$fast"},
	},
	{
		name:   "a function that runs an Effect gets a generator, a wrapper, and a fast entry",
		source: "function greet(id: string) {\n  const user = find(id)\n  return user.name\n}\nfunction twice(id: string) {\n  return greet(id) + greet(id)\n}\n",
		contains: []string{
			"function greet(...$args) { return (greet$effect ??= $fnUntraced(greet$body)).apply(this, $args); }",
			"function greet$fast(id) { const it = greet$body(id), s = it.next(); return s.done ? $done(s.value) : $settle(it, s); }",
			"function* greet$body(id) {",
			"const user = (($t = find(id)), $isRun($t) ? (yield* $t) : $t);",
			"return (($t = greet$fast(id)), $isRun($t) ? (yield* $t) : $t) + (($t = greet$fast(id)), $isRun($t) ? (yield* $t) : $t);",
			"var $t;",
		},
		absent: []string{"greet$direct"},
	},
	{
		name:     "a function in value position is the Effect wrapper (L2)",
		source:   "function double(n: number) {\n  return n * 2\n}\nexport function main() {\n  return [1, 2].map(double)\n}\n",
		contains: []string{"[1, 2].map(double)"},
		absent:   []string{"map(double$direct)"},
	},
	{
		name:   "a call of an imported function reads its $direct property",
		source: "import { shout } from \"./b.vibe\"\nfunction f(x: string) {\n  return shout(x)\n}\n",
		contains: []string{
			`import { shout } from "./b.js";`,
			"return (($t = (shout[$direct] ?? shout)(x)), shout[$direct] ? $t : ($isRun($t) ? (yield* $t) : $t));",
		},
	},
	{
		name:   "a plain return annotation keeps a plain function, whose calls do not run (L2)",
		source: "function len(s: string): number {\n  return s.trim().length\n}\nfunction f(s: string) {\n  return len(s)\n}\n",
		contains: []string{
			"function len(s) {\n    return s.trim().length;\n}",
			"return (($t = len(s)), $isRun($t) ? (yield* $t) : $t);",
		},
		absent: []string{"len$direct", "len$fast"},
	},
	{
		name:   "a service member call reads the service unless the key owns the member (D41, L8)",
		source: "service Users {\n  find(id: string): string!!\n}\nfunction f(id: string) {\n  return Users.find(id) + Users.pipe()\n}\n",
		contains: []string{
			`class Users extends $service("app/src/main#Users") {`,
			"(($s = Users), $isKey($s) ? (yield* $s) : $s).find(id)",
			"(($t = Users.pipe()), $isRun($t) ? (yield* $t) : $t)",
		},
	},
	{
		name:     "a member call on another key reads the service only when the key lacks the member",
		source:   "import { Sessions } from \"./sessions.vibe\"\nfunction f() {\n  return Sessions.get(\"t\")\n}\n",
		contains: []string{`$method((($s = Sessions), $isKey($s) && !("get" in $s) ? (yield* $s) : $s), "get", ["t"], $methodCandidates_get)`},
	},
	{
		name:     "a control registers its operations and their parameter counts",
		source:   "control Approval {\n  approve(request: string, level?: number): boolean!!\n}\n",
		contains: []string{`$control(Approval, ["approve"], [2]);`},
	},
	{
		name:     "a service with a static default passes it to $reference (D40)",
		source:   "service Flags {\n  readonly on: boolean\n  static readonly defaultValue = () => ({ on: false })\n}\n",
		contains: []string{`class Flags extends $reference("app/src/main#Flags", () => Flags.defaultValue()) {`},
	},
	{
		name:   "regions keep the checking rendering's completions, defined at run time",
		source: "function f(xs: number[]) {\n  for (const x of xs) {\n    try {\n      if (x === 2) break\n      g(x)\n    } finally {\n      h()\n    }\n  }\n  return 1\n}\n",
		contains: []string{
			"const $end = {};",
			"class $Jump {\n    constructor(k) { this.k = k; }\n}",
			`const $c = yield* $finally($gen(function* () {`,
			`return $jump("break:");`,
			`if ($jumped($c, "break:"))`,
		},
	},
	{
		name:     "a value call runs a key or an Effect value, and calls a function (D90)",
		source:   "import { Users } from \"./users.vibe\"\nfunction f() {\n  return Users()\n}\n",
		contains: []string{"const $value = (v) => typeof v === \"function\" && !$isKey(v) ? v : () => $gen(function* () { return yield* v; });", "$value(Users)()"},
	},
	{
		name:     "throw fails the Effect (D46)",
		source:   "function f(n: number) {\n  if (n < 0) throw new Error(\"negative\")\n  return n\n}\n",
		contains: []string{`return yield* $fail(new Error("negative"));`},
		absent:   []string{"f$direct"},
	},
	{
		name:     "a function that holds a using gets a Scope of its own, and no fast entry",
		source:   "function f() {\n  using r = lease(1)\n  return r.id\n}\nfunction g() {\n  return f()\n}\n",
		contains: []string{"return $region(($scope) => $gen(function* () {", "const r = (yield* $acquire($scope, lease(1)));", "(($t = f()), $isRun($t) ? (yield* $t) : $t)"},
		absent:   []string{"f$fast", "f$body"},
	},
	{
		name:   "a producer runs under the runtime's Yield operation, and for...of takes a Stream's elements (D26)",
		source: "function* numbers(n: number) {\n  for (let i = 0; i < n; i++) yield i\n  yield* more(1)\n  yield\n}\nfunction sum() {\n  let s = 0\n  for (const x of numbers(3)) s += x\n  return s\n}\n",
		contains: []string{
			"return $produce(() => $producerGen(function* () {",
			"yield* $yield(i);",
			"yield* $yieldAll((($t = more(1)), $isRun($t) ? (yield* $t) : $t));",
			"yield* $yield(undefined);",
			"yield* $iterate((($t = numbers(3)), $isRun($t) ? (yield* $t) : $t),",
			"const x = $item;",
		},
	},
	{
		name:     "an entry module runs main when the host starts it (D135)",
		source:   "export function main() {\n  return 1\n}\n",
		contains: []string{"$entry(import.meta.main, import.meta.url, main, () => $runMain(main()));"},
	},
	{
		name:     "a module that calls a runner itself gets no entry statement",
		source:   "export function main() {\n  return 1\n}\nrunPromise(main())\n",
		absent:   []string{"import.meta.main", "$entry"},
		contains: []string{"runPromise($gen(function* () { return main$direct(); }))"},
	},

	{
		name:     "a written Effect contract infers channels without runtime helpers (D57)",
		source:   "class Gone extends TaggedError(\"Gone\")<{}> {}\nexport function f(n: number): Effect<number, infer E, infer R> { if (n < 0) throw new Gone(); return n }",
		contains: []string{"function* f$body(n)", "return yield* $fail(new Gone());"},
		absent:   []string{"$Contract", "$Infer", "$contract"},
	},
	{
		name:     "a plain contract callback stays plain at runtime (D67)",
		source:   "import { Schema } from \"effect\"; const s = Schema.suspend((): Effect<Schema.Codec<A, B>, never, never> => s)",
		contains: []string{"Schema.suspend(() => s)"},
		absent:   []string{"$gen"},
	},

	{
		name:     "an Effect contract with an infer channel erases to the generator (D57)",
		source:   "class Gone extends TaggedError(\"Gone\")<{}> {}\nexport function f(n: number): number!infer E {\n  if (n < 0) throw new Gone()\n  return n\n}\n",
		contains: []string{"function* f$body(n) {", "return yield* $fail(new Gone());"},
		absent:   []string{"$Contract", "$Infer"},
	},
}

// TestEmit checks the executable rendering's rules on small sources.
func TestEmit(t *testing.T) {
	t.Parallel()
	for _, c := range emitCases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			js, _, diagnostics := Emit(c.source, testContext)
			assert.Equal(t, len(diagnostics), 0, "diagnostics: %v\n%s", diagnostics, js)
			for _, want := range c.contains {
				assert.Assert(t, strings.Contains(js, want), "missing %q in\n%s", want, js)
			}
			for _, unwanted := range c.absent {
				assert.Assert(t, !strings.Contains(js, unwanted), "unexpected %q in\n%s", unwanted, js)
			}
		})
	}
}

// TestEmitCorpusDeclarations checks the controls and static-default service
// in the corpus, both before and after TypeScript erases their types.
func TestEmitCorpusDeclarations(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name          string
		registrations []string
		reference     string
	}{
		{
			name: "handle-tail-resume",
			registrations: []string{
				`$control(Approval, ["approve"], [1]);`,
				`$control(Notes, ["note"], [1]);`,
			},
		},
		{
			name:      "vibelang-services-default",
			reference: "FeatureFlags",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			data, err := os.ReadFile(filepath.Join("../../../vibelang/cases", c.name, "main.vibe"))
			assert.NilError(t, err)
			source := string(data)
			executable := Executable(source, testContext)
			js, _, diagnostics := Emit(source, testContext)
			assert.Equal(t, len(executable.Diagnostics), 0, "diagnostics: %v", executable.Diagnostics)
			assert.Equal(t, len(diagnostics), 0, "diagnostics: %v", diagnostics)
			for _, text := range []string{executable.Text, js} {
				assert.Equal(t, strings.Count(text, "$control("), len(c.registrations), "%s", text)
				for _, registration := range c.registrations {
					assert.Equal(t, strings.Count(text, registration), 1, "%s", text)
				}
			}
			if name := c.reference; name != "" {
				args := `("app/src/main#` + name + `", () => ` + name + `.defaultValue())`
				assert.Assert(t, strings.Contains(executable.Text, "$reference<"+name+">"+args), "%s", executable.Text)
				assert.Assert(t, strings.Contains(js, "$reference"+args), "%s", js)
			}
		})
	}
}

// TestEmitScopeOwnership keeps a using's private Scope out of ordinary
// acquisitions, and keeps a lowered block valid as an if branch (D14).
func TestEmitScopeOwnership(t *testing.T) {
	t.Parallel()
	source := `function f() {
   const kept = acquire("kept")
   using log = acquire("log")
   if (kept) { using inner = acquire("inner") }
   return kept
 }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "$region(($scope) => $gen(function* () {"), js)
	assert.Assert(t, strings.Contains(js, "$acquire($scope, acquire(\"log\"))"), js)
	assert.Equal(t, strings.Count(js, "$region("), 2, js)
	assert.Assert(t, !strings.Contains(js, "$scopedBody"), js)
}

// TestEmitForkRegions gives a fork to the region the source names (D408): an
// arrow's expression body owns its fork (D353), an if branch and a do block
// own nothing, so the function body's region owns theirs, and a loop body
// block owns each iteration's.
func TestEmitForkRegions(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, source string
		regions      int
	}{
		{"arrow expression body", `const f = (): number!! => Fiber.join(fork(() => 1))`, 1},
		{"if branch", "function f(b: boolean) {\n  if (b) { fork(() => 1) }\n  return 0\n}", 1},
		{"do block", "function f() {\n  const x = do { fork(() => 1); 2 }\n  return x\n}", 1},
		{"loop body", "function f() {\n  for (const n of [1, 2]) { fork(() => n) }\n  return 0\n}", 1},
		{"loop body without braces", "function f() {\n  for (const n of [1, 2]) fork(() => n)\n  return 0\n}", 1},
		{"loop body without braces that continues", "function f() {\n  for (const n of [1, 2]) if (n > 1) continue; else fork(() => n)\n  return 0\n}", 1},
		{"loop body and function body", "function f() {\n  fork(() => 0)\n  for (const n of [1, 2]) { fork(() => n) }\n  return 0\n}", 2},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			js, _, diagnostics := Emit(c.source, testContext)
			assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
			assert.Equal(t, strings.Count(js, "$region("), c.regions, js)
			assert.Assert(t, strings.Contains(js, "$provideScope("), js)
			assert.Assert(t, !strings.Contains(js, "$scopedBody"), js)
		})
	}
	virtual := Project(`export const f = (): number!! => Fiber.join(fork(() => 1))`, testContext).Text
	assert.Assert(t, strings.Contains(virtual, "$scoped(fork)"), virtual)
}

// TestEmitCorpusSyntax catches a lowered scope losing its statement braces
// or separator before else, both of which single-file transpilation recovers.
func TestEmitCorpusSyntax(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"scopes-using", "decl-handle"} {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("../../../vibelang/cases", name, "main.vibe"))
			assert.NilError(t, err)
			js, _, diagnostics := Emit(string(data), testContext)
			for _, d := range diagnostics {
				assert.Assert(t, d.Code != CodeExecSyntax, "%v", diagnostics)
			}
			if node, err := exec.LookPath("node"); err == nil {
				cmd := exec.Command(node, "--check", "--input-type=module")
				cmd.Stdin = strings.NewReader(js)
				output, err := cmd.CombinedOutput()
				assert.NilError(t, err, "%s", output)
			}
		})
	}
}

// TestEmitIsDeterministic checks that equal text emits equal output.
func TestEmitIsDeterministic(t *testing.T) {
	t.Parallel()
	for _, c := range emitCases {
		js1, map1, _ := Emit(c.source, testContext)
		js2, map2, _ := Emit(c.source, testContext)
		assert.Equal(t, js1, js2)
		assert.Equal(t, map1, map2)
	}
}

// TestEmitSourceMap checks that the source map takes a verbatim name in
// the JavaScript back to its original line and column, through the
// transpiler's map and the plan's segments, and names the original file.
func TestEmitSourceMap(t *testing.T) {
	t.Parallel()
	source := "// one\nfunction greet(id: string) {\n  const user = find(id)\n  return user.name\n}\n"
	js, sourceMap, _ := Emit(source, testContext)
	var raw sourcemap.RawSourceMap
	assert.NilError(t, json.Unmarshal([]byte(sourceMap), &raw))
	assert.DeepEqual(t, raw.Sources, []string{"main.vibe"})
	assert.Equal(t, raw.File, "main.js")
	assert.Equal(t, *raw.SourcesContent[0], source)
	at := strings.Index(js, "find(id)")
	assert.Assert(t, at > 0)
	lines := core.ComputeECMALineStarts(js)
	line := 0
	for line+1 < len(lines) && int(lines[line+1]) <= at {
		line++
	}
	column := at - int(lines[line])
	found := false
	for m := range sourcemap.DecodeMappings(raw.Mappings).Values() {
		if m.GeneratedLine == line && int(m.GeneratedCharacter) == column {
			found = true
			// find(id) is on line 3 (index 2), at column 15 (index 15).
			assert.Equal(t, m.SourceLine, 2)
			assert.Equal(t, int(m.SourceCharacter), 15)
		}
	}
	assert.Assert(t, found, "no mapping at %d:%d in %s", line, column, raw.Mappings)
}

// TestEmitReportsUnparsedText checks that text of the rendering that does
// not parse, here a syntax error of the source, reaches the caller as a
// CodeExecSyntax diagnostic in original coordinates, and that Emit still
// returns JavaScript.
func TestEmitReportsUnparsedText(t *testing.T) {
	t.Parallel()
	source := "function f(x: number) {\n  return x +\n}\n"
	js, _, diagnostics := Emit(source, testContext)
	assert.Assert(t, js != "")
	assert.Assert(t, len(diagnostics) > 0)
	for _, d := range diagnostics {
		assert.Equal(t, d.Code, int32(CodeExecSyntax))
		assert.Assert(t, d.Start >= 0 && d.Start+d.Length <= len(source), "diagnostic %v out of range", d)
		assert.Assert(t, strings.Contains(d.Message, "TS1109: Expression expected."), d.Message)
	}
}

// TestEmitScopedContract keeps the contract's closing function brace
// outside the private Scope and optional tracing wrapper (D14, D34, D57).
func TestEmitScopedContract(t *testing.T) {
	t.Parallel()
	ctx := testContext
	ctx.Tracing = "all"
	js, _, diagnostics := Emit("function f(): string!infer E { using r = lease(1); return r.name }", ctx)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "$withSpan($region(($scope) => $gen(function* () {"), js)
	assert.Assert(t, !strings.Contains(js, "f$fast"), js)
}

// TestEmitLoopRegions checks that iteration pulls rather than collecting,
// and that loop callbacks propagate returns and labeled exits (D26).
func TestEmitLoopRegions(t *testing.T) {
	t.Parallel()
	source := `function f(xs: number[]) {
 outer: for (const x of xs) {
   for (const y of xs) { if (y > x) continue outer; if (y === 3) return y }
   if (x === 4) break
 }
 return 0
 }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Equal(t, strings.Count(js, "yield* $iterate("), 2, js)
	assert.Assert(t, strings.Contains(js, `return $jump("continue:outer")`), js)
	assert.Assert(t, strings.Contains(js, `return $jump("break:")`), js)
	assert.Assert(t, !strings.Contains(js, "$runCollect"), js)
}

// TestEmitProducerCleanup makes native generator finalizers part of the
// producer Effect's exit, including interruption after an early pull.
func TestEmitProducerCleanup(t *testing.T) {
	t.Parallel()
	source := `function* values() { try { yield 1; yield 2 } finally { release() } }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "$produce(() => $producerGen(function* () {"), js)
	assert.Assert(t, strings.Contains(js, "$onExit($gen(() => it)"), js)
	assert.Assert(t, strings.Contains(js, "it.return(undefined)"), js)
}

// TestEmitTracing keeps named functions, variable-bound arrows, and class
// methods in their D34 spans; calls must not bypass them through fast entries.
func TestEmitTracing(t *testing.T) {
	t.Parallel()
	source := `function inner() { return Effect.currentSpan().name }
 const viaArrow = () => Effect.currentSpan().name
 service Greeter { greet(): string!! }
 class Hello implements Greeter { greet() { return Effect.currentSpan().name } }
 export function main() { return [inner(), viaArrow(), new Hello().greet()] }`
	for _, mode := range []string{"all", "exported"} {
		t.Run(mode, func(t *testing.T) {
			ctx := testContext
			ctx.Tracing = mode
			js, _, diagnostics := Emit(source, ctx)
			for _, d := range diagnostics {
				assert.Assert(t, d.Code != CodeExecSyntax, "%v\n%s", diagnostics, js)
			}
			assert.Assert(t, strings.Contains(js, `}), "main")`), js)
			for _, name := range []string{"inner", "viaArrow", "Hello.greet"} {
				assert.Equal(t, strings.Contains(js, `}), "`+name+`")`), mode == "all", js)
			}
			assert.Assert(t, !strings.Contains(js, "main$fast"), js)
			if mode == "all" {
				assert.Assert(t, strings.Contains(js, "(($t = inner()), $isRun($t) ? (yield* $t) : $t)"), js)
				assert.Assert(t, !strings.Contains(js, "inner$fast"), js)
			}
		})
	}
}

// TestEmitClauseContinuation keeps the continuation last when bindings
// omit operation parameters, and propagates a resumed return after cleanup.
func TestEmitClauseContinuation(t *testing.T) {
	t.Parallel()
	source := `control Log { write(message: string, level?: string): void!! }
 function f() {
  try { Log.write("hi"); return 7 }
  handle Log.write(message) { resume(); record(message) }
 }
 function g() {
  try { Log.write("hi"); return 8 }
  handle Log.write(message) { using r = lease(); resume() }
 }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "write: (message, $ignored1, ...$clauseArgs) =>"), js)
	assert.Assert(t, strings.Contains(js, "const $k = $clauseArgs[$clauseArgs.length - 1]"), js)
	assert.Assert(t, strings.Contains(js, "return $pending"), js)
	assert.Assert(t, strings.Contains(js, "yield* $resume($k, undefined)"), js)
}

// TestProgramValuesRuntime checks that both program conversions and pipe
// boundaries remain cold and run exactly once per requested execution. A
// non-entry export keeps the manual runner independent of import.meta.main.
func TestProgramValuesRuntime(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	source := `let runs = 0
function job() { runs++; return runs }
const top = Effect.runSync(Effect.succeed(8))
export function scenario() {
 const jobs = new Set([() => job(), () => job()])
 const values = Effect.all(jobs)
 const piped = pipe(() => job(), Effect.retry({ times: 2 }))
 const topic = job() |> Effect.retry(%, { times: 2 })
 const block = Effect.retry(do { job(); job() }, { times: 2 })
 return { values, piped, topic, block, top, runs }
}`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nconsole.log(JSON.stringify(await Effect.runPromise(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), `{"values":[1,2],"piped":3,"topic":4,"block":6,"top":8,"runs":6}`)
}

// TestThrowCauseRuntime checks D406 through the ordinary catch and exit
// boundaries: Effect.failCause preserves a cause's reasons, defects in a
// combined cause included, and throw fails with the value it is given, a
// Cause held as unknown too, which the text projector cannot tell apart.
func TestThrowCauseRuntime(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	// Use a local fixture: the language corpus awaits D253's separate
	// annotation migration, while this test exercises Cause boundaries.
	source := `import { map as mapReasons } from "effect/Array"
error Expected

function fail() {
  Effect.failCause(Cause.fail(new Expected()))
}

function defect() {
  Effect.failCause(Cause.die("defect"))
}

function combined() {
  Effect.failCause(Cause.combine(Cause.fail(new Expected()), Cause.die("combined defect")))
}

function value() {
  const cause: unknown = Cause.die("not rethrown")
  try {
    throw cause
  } catch (e) {
    return e === cause ? "cause object" : "other"
  }
}

function caught() {
  try {
    fail()
    return "missing"
  } catch (e) {
    return match (e) {
      when Expected: "expected";
      default: throw e;
    }
  }
}

function reasons(outcome: Exit.Exit<unknown, Expected>) {
  return match (outcome) {
    when Exit.Success(let value): ["Success"];
    when Exit.Failure(let cause): mapReasons(cause.reasons, (reason) => reason._tag);
  }
}

export function main() {
  return {
    caught: caught(),
    defect: reasons(exit(defect())),
    combined: reasons(exit(combined())),
    escaped: reasons(exit(fail())),
    value: value()
  }
}
`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport { runPromise as runCauseTest } from 'effect/Effect'; console.log(JSON.stringify(await runCauseTest(main())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	expected := `{"caught":"expected","defect":["Die"],"combined":["Fail","Die"],"escaped":["Fail"],"value":"cause object"}`
	assert.Equal(t, strings.TrimSpace(string(out)), expected)
}

// TestEmitDoControlFlowCLI checks that diagnostics reach the command's exit
// status in both output modes; callers must not execute rejected source.
func TestEmitDoControlFlowCLI(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "vibelang-mapper")
	build := exec.Command("go", "build", "-o", binary, "../../cmd/vibelang-mapper")
	out, err := build.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	for _, c := range []struct {
		source string
		code   string
	}{
		{"function f() { return do { return 1; 2 } }", "EK1108"},
		{"function f() { while (true) { const x = do { break; 1 } } }", "EK1107"},
		{"function f() { while (true) { const x = do { continue; 1 } } }", "EK1107"},
	} {
		source := filepath.Join(dir, "main.vibe")
		assert.NilError(t, os.WriteFile(source, []byte(c.source), 0600))
		for _, file := range []bool{false, true} {
			args := []string{"--emit", source}
			if file {
				args = append(args, "--out", filepath.Join(dir, "main.js"))
			}
			out, err := exec.Command(binary, args...).CombinedOutput()
			exit, ok := err.(*exec.ExitError)
			assert.Assert(t, ok, "expected a failing exit: %v\n%s", err, out)
			assert.Equal(t, exit.ExitCode(), 1)
			assert.Assert(t, strings.Contains(string(out), c.code), "%s", out)
		}
	}
}

// TestEmitCallTailResume checks D18 for method and lambda clauses, while
// retaining ordinary resumes in nested functions and cleanup regions.
func TestEmitCallTailResume(t *testing.T) {
	for _, clause := range []string{
		`ask(q, k) { return resume(k, 1) }`,
		`ask: (q, k) => resume(k, 1)`,
		`ask: function(q, k) { return (resume(k, 1)) }`,
		`ask(q, k) { if (q) return resume(k, 1); return resume(k, 2) }`,
		`ask(q, k) { return resumeWith(k, () => 1) }`,
	} {
		js, _, ds := Emit(`control Ask { ask(q: string): number!! } function f() { return handle(() => Ask.ask("q"), Ask, {`+clause+`}) }`, testContext)
		assert.Equal(t, len(ds), 0, "%v", ds)
		assert.Assert(t, strings.Contains(js, "$tailResume"), js)
		assert.Assert(t, !strings.Contains(js, "$t = resume("), js)
	}
	for _, clause := range []string{
		`ask(q, k) { try { return resume(k, 1) } finally { log() } }`,
		`ask(q, k) { using r = lease(); return resume(k, 1) }`,
		`ask(q, k) { const nested = () => resume(k, 1); return nested() }`,
		`ask(q, k) { const n = resume(k, 1); return n + 1 }`,
	} {
		js, _, ds := Emit(`control Ask { ask(q: string): number!! } function f() { return handle(() => Ask.ask("q"), Ask, {`+clause+`}) }`, testContext)
		assert.Equal(t, len(ds), 0, "%v", ds)
		assert.Assert(t, !strings.Contains(js, "$tailResume"), js)
	}
}

// TestTailResumeDepthRuntime exercises 100,000 producer elements and both
// handle forms: checking results alone misses suspended clause stack growth.
func TestTailResumeDepthRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	source := `import { hooks } from "vibelang-runtime/kernel"
control Tick { tick(n: number): void!! }
function* count() { for (let i = 0; i < 100000; i++) yield i }
function ticks() { for (let i = 0; i < 100000; i++) Tick.tick(i); return 100000 }
export function scenario() {
 let depth = 0
 hooks.onResume = (fiber): void => { depth = Math.max(depth, fiber._stack.length) }
 let sum = 0
 for (const n of count()) sum += n
 let seen = 0
 const called = handle(() => ticks(), Tick, { tick(n, k) { seen++; return resume(k, undefined) } })
 let stated = 0
 try { ticks() } handle Tick.tick(n) { stated++; resume() }
 hooks.onResume = undefined
 return { sum, seen, called, stated, bounded: depth < 50 }
}`
	js, _, ds := Emit(source, testContext)
	assert.Equal(t, len(ds), 0, "%v", ds)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport { runPromise as runDepthTest } from 'effect/Effect'; console.log(JSON.stringify(await runDepthTest(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	assert.Equal(t, strings.TrimSpace(string(out)), `{"sum":4999950000,"seen":100000,"called":100000,"stated":100000,"bounded":true}`)
}

// TestHatchMappingRuntime checks a hatch's lazy data expressions against the
// fork's values.
func TestHatchMappingRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	source := `const cold = BigDecimal.make(2n, 0).multiply(BigDecimal.make(3n, 0))
export function scenario() {
 const zero = sync(BigDecimal.fromNumberUnsafe(0))
 const codec = sync(Schema.toCodecJson(Schema.String))
 return { cold: BigDecimal.format(cold), zero: BigDecimal.format(zero), codec: codec.ast._tag }
}`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader("import { Effect } from \"effect\"\n" + js + "\nconsole.log(JSON.stringify(await Effect.runPromise(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), `{"cold":"6","zero":"0","codec":"String"}`)
}

// A checking witness must not add reads of a getter used as the subject.
func TestErrorExtractorSubjectReads(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	source := `error B { code: string }
let reads = 0
const holder = { get error(): B { reads++; return new B({ code: "b" }) } }
export function scenario() {
 const value = match (holder.error) { when B(let b): b.code; default: "missing"; }
 return { value, reads }
}`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport { runPromise as runExtractorCase } from 'effect/Effect'; console.log(JSON.stringify(await runExtractorCase(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), `{"value":"b","reads":1}`)
}

// A match or is reads its subject once when the program runs (D214), in every
// form, while the checking rendering keeps its tests on a subject that is an
// identifier expression, so stock TypeScript narrows it in each arm.
func TestCapturedSubjectReads(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	source := `interface Box { state: "a" | "b" | "c"; reads: number }
function box(): Box {
 let reads = 0
 return { get state(): "a" | "b" | "c" { reads++; return reads === 1 ? "c" : "b" }, get reads(): number { return reads } }
}
function returned(b: Box): number {
 return match (b.state) { when "a": 1; when "b": 2; when "c": 3; }
}
function expression(b: Box): number {
 const n = match (b.state) { when "a": 1; when "b": 2; when "c": 3; }
 return n
}
function statement(b: Box): number {
 let n = 0
 match (b.state) { when "a": n = 1; when "b": n = 2; when "c": n = 3; }
 return n
}
function either(b: Box): boolean {
 return b.state is "a" or "b"
}
export function scenario() {
 const r = box(), e = box(), s = box(), i = box()
 return [returned(r), r.reads, expression(e), e.reads, statement(s), s.reads, either(i), i.reads]
}`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport { runPromise as runCapturedCase } from 'effect/Effect'; console.log(JSON.stringify(await runCapturedCase(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), `[3,1,3,1,3,1,false,1]`)
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	for _, checking := range []string{`void b.state; { if (b.state === "a")`, `return (((b.state === "a") || (b.state === "b")))`} {
		assert.Assert(t, strings.Contains(projection.Text, checking), "%s", projection.Text)
	}
}

// An is whose pattern reads its subject not at all, such as a guard, still
// reads it when checking, so the subject counts as read under
// noUnusedParameters, and once when the program runs.
func TestCapturedSubjectReadByAGuard(t *testing.T) {
	t.Parallel()
	source := `function guardOnly(box: { v: number }): boolean {
 return box.v is if (true)
}`
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assert.Assert(t, strings.Contains(projection.Text, `return (void box.v, (true))`), "%s", projection.Text)
	executable := Executable(source, testContext)
	assert.Assert(t, strings.Contains(executable.Text, `=> (true))(box.v)`), "%s", executable.Text)
}
