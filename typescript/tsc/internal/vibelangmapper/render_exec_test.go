// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK9002` | compiler projection error: the mapper's executable rendering does not parse as TypeScript; report the source and use the native compiler.
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
// JavaScript must contain, and text it must not. Rows that record the
// retired implicit-effects language are listed in
// testdata/legacy-language.txt (TestLegacyLanguageCensus).
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

	{
		name:     "interleaved static service retains its key and erased instance shape",
		source:   "export service Counter { increment(): void!!\n static readonly layer = Layer.succeed(Counter, { increment: () => {}, read: () => 2 })\n read(): number!!\n}",
		contains: []string{`class Counter extends $service("app/src/main#Counter")`, `static layer = Layer.succeed(Counter`},
		absent:   []string{"abstract read", "interface Counter", "number!!"},
	},

	{
		name:     "data methods and predicates call the module without prototypes",
		source:   "function f(o: Option.Option<number>) { if (o.isSome()) return o.getOrElse(() => 0); return 0 }",
		contains: []string{"Option.isSome(o)", "Option.getOrElse(o, () => 0)"},
		absent:   []string{"o.isSome()", "o.getOrElse("},
	},

	{
		name:     "library data call stays lazy plain TypeScript",
		source:   "function f() { return sync(BigDecimal.fromNumberUnsafe(0)) }",
		contains: []string{"sync(() => (BigDecimal.fromNumberUnsafe(0)))"},
		absent:   []string{"$value(BigDecimal", "yield* BigDecimal"},
	},

	{
		name:     "known stream chains use module functions in both renderings",
		source:   "function f(xs: Stream.Stream<number>) { return xs.filter((n) => n > 0).map((n) => n + 1) }",
		contains: []string{"Stream.map(", "Stream.filter(xs, (n) => n > 0)"},
		absent:   []string{".filter((n)", ".map((n)"},
	},
	{
		name:     "acyclic entries forward defaults rest and destructuring once",
		source:   "effect function f(a = seed(), { x } = object(), [y] = array(), ...rest: number[]) { return try unknown(a, x, y, rest) }",
		contains: []string{"function f$fast(a, $arg1, $arg2, ...rest)", "f$body(a, $arg1, $arg2, ...rest)", "function* f$body(a = seed(), { x } = object(), [y] = array(), ...rest)"},
		absent:   []string{"const f$fast", "$fast(f$body)"},
	},
	{
		name:     "a body that reads arguments keeps the counted entry, which forwards every argument",
		source:   "effect function f(a: number) { return try unknown(arguments.length, () => arguments[1]) }",
		contains: []string{"const f$fast = $fast(f$body);"},
		absent:   []string{"function f$fast("},
	},
	{
		name:     "arguments of a nested function don't count",
		source:   "effect function f(a: number) { return try unknown(function () { return arguments.length }) }",
		contains: []string{"function f$fast(a)"},
		absent:   []string{"const f$fast"},
	},
	{
		name:     "direct recursion counts eager depth",
		source:   "effect function f(n: number) { try unknown(); return n ? try f(n - 1) : 0 }",
		contains: []string{"const f$fast = $fast(f$body);", "f$fast(n - 1)"},
	},
	{
		name:     "mutual recursion counts only cycle members",
		source:   "effect function f(n: number) { return n ? try g(n - 1) : try unknown() } effect function g(n: number) { return try f(n) } effect function outer(n: number) { return try f(n) }",
		contains: []string{"const f$fast = $fast(f$body);", "const g$fast = $fast(g$body);", "function outer$fast(n)"},
		absent:   []string{"const outer$fast"},
	},

	{
		name:     "fiber forms in do bodies retain executable run boundaries",
		source:   "effect function f(a: Fiber.Fiber<number>) { return do { join a } } effect function g() { return do { for concurrent (const x of [1]) { try log(x) } 1 } }",
		contains: []string{"$join(a)", "Effect.forEach([1], ($concurrentItem) => $gen(function* () { const x = $concurrentItem; {", "$isRun($t) ? (yield* $t) : $t"},
		absent:   []string{"for concurrent", "return join ", "f$direct", "g$direct"},
	},
	{
		name:     "join runs native fibers inside array and object values",
		source:   "effect function f(a: Fiber.Fiber<number>, b: Fiber.Fiber<string>) { const x = join a; const y = [join a, join b]; return { x, y } }",
		contains: []string{"$join(a)", "$join(b)", "from \"effect/Fiber\"", "$isRun($t) ? (yield* $t) : $t"},
		absent:   []string{"const x = join ", "f$direct", "$asProgram(a)"},
	},
	{
		name:     "concurrent loops defer bodies and continue returns from one item",
		source:   "effect function f(xs: number[]) { for concurrent(2) (const x of xs) { if (!x) continue; try log(x) } for concurrent (const x of xs) try log(x) }",
		contains: []string{"Effect.forEach(xs, ($concurrentItem) => $gen(function* () { const x = $concurrentItem; {", "concurrency: $concurrency", `concurrency: "unbounded"`, "return;", "log(x)"},
		absent:   []string{"for concurrent", "continue", "f$direct"},
	},

	{
		name:   "catch expressions run their evaluated operands",
		source: "effect function f() { return a() catch e => recover(e) }",
		contains: []string{
			`import { $catch, $done, $isRun, $settle } from "vibelang-runtime/internal";`,
			"$catch(a(), ($catchError => Effect.succeed((e => recover(e))($catchError))))",
		},
		absent: []string{"$catchExpression", "f$direct"},
	},
	{
		name:     "a catch fallback in a pipe keeps the evaluated topic",
		source:   `declare function input(): string!!; declare function find(id: string): string!!; declare function backup(id: string): string!!; effect function f() { return (try input()) |> find(%) catch () => "none" }`,
		contains: []string{"const $topic = ((yield* $try(input())));", "$catch(find($topic), "},
		absent:   []string{"|>", "(%)", "f$direct"},
	},

	{
		name:     "a function that runs an Effect gets a generator, a wrapper, and a fast entry",
		source:   "effect function greet(id: string) {\n  const user = try find(id)\n  return user.name\n}\neffect function twice(id: string) {\n  return (try greet(id)) + (try greet(id))\n}\n",
		contains: []string{"function greet(...$args) { return (greet$effect ??= $fnUntraced(greet$body)).apply(this, $args); }", "function greet$fast(id) { const it = greet$body(id), s = it.next(); return s.done ? $done(s.value) : $settle(it, s); }", "function* greet$body(id) {", "var $t;"},
		absent:   []string{"greet$direct"},
	},
	{
		name:     "a function in value position is the Effect wrapper (L2)",
		source:   "function double(n: number) {\n  return n * 2\n}\nexport function main() {\n  return [1, 2].map(double)\n}\n",
		contains: []string{"[1, 2].map(double)"},
		absent:   []string{"map(double$direct)"},
	},

	{
		name:     "a service with a static default passes it to $reference (D40)",
		source:   "service Flags {\n  readonly on: boolean\n  static readonly defaultValue = () => ({ on: false })\n}\n",
		contains: []string{`class Flags extends $reference("app/src/main#Flags", () => Flags.defaultValue()) {`},
	},

	{
		name:     "throw fails the Effect (D46)",
		source:   "effect function f(n: number) {\n  if (n < 0) throw new Error(\"negative\")\n  return n\n}\n",
		contains: []string{`return yield* $fail(new Error("negative"));`},
		absent:   []string{"f$direct"},
	},

	{
		name:     "a producer runs under the runtime's Yield operation, and for try takes a Stream's elements (D26)",
		source:   "effect function* numbers(n: number) {\n  for (let i = 0; i < n; i++) yield i\n  yield* more(1)\n  yield\n}\neffect function sum() {\n  let s = 0\n  for try (const x of numbers(3)) s += x\n  return s\n}\n",
		contains: []string{"return $produce(() => $producerGen(function* () {", "yield* $yield(i);", "yield* $yield(undefined);", "const x = $item;"},
	},
	{
		name:     "an entry module runs main when the host starts it (D135)",
		source:   "export effect function main() {\n  return try log(1)\n}\n",
		contains: []string{"$entry(import.meta.main, import.meta.url, main, () => $runMain(main()));"},
	},
	{
		name:     "a module that calls a runner itself gets no entry statement",
		source:   "export effect function main() {\n  return 1\n}\nrunPromise(main())\n",
		absent:   []string{"import.meta.main", "$entry"},
		contains: []string{"runPromise(main());"},
	},

	{
		name:     "a written Effect contract infers channels without runtime helpers (D57)",
		source:   "class Gone extends TaggedError(\"Gone\")<{}> {}\nexport effect function f(n: number): Effect<number, infer E, infer R> { if (n < 0) throw new Gone(); return n }",
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
		source:   "class Gone extends TaggedError(\"Gone\")<{}> {}\nexport effect function f(n: number): number!infer E {\n  if (n < 0) throw new Gone()\n  return n\n}\n",
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

// TestEmitCorpusDeclarations checks the static-default service
// in the corpus, both before and after TypeScript erases their types.
func TestEmitCorpusDeclarations(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name      string
		reference string
	}{
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
	source := `effect function f() {
   const kept = try acquire("kept")
   const log = fork acquire("log")
   if (kept) { fork acquire("inner") }
   return kept
 }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "$region(($scope) => $gen(function* () {"), js)
	assert.Assert(t, !strings.Contains(js, "f$fast"), js)
	assert.Assert(t, strings.Contains(js, "const kept = (yield* $try(acquire(\"kept\")))"), js)
	// An if branch owns nothing, so the function body's region owns both fibers.
	assert.Equal(t, strings.Count(js, "$region("), 1, js)
	assert.Assert(t, !strings.Contains(js, "$scopedBody"), js)
	// using is TypeScript's (VIP-8): the resource is disposed by the
	// generated JavaScript, and no Effect Scope is opened for it.
	js, _, diagnostics = Emit("effect function g() { using log = acquire(\"log\"); return 1 }", testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "__addDisposableResource(env_1, acquire(\"log\"), false)") && !strings.Contains(js, "$region(") && !strings.Contains(js, "$acquire"), js)
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
		{"arrow expression body", `const f = effect (): number!! => join (fork Effect.succeed(1))`, 1},
		{"if branch", "effect function f(b: boolean) {\n  if (b) { fork Effect.succeed(1) }\n  return 0\n}", 1},
		{"do block", "effect function f() {\n  const x = do { fork Effect.succeed(1); 2 }\n  return x\n}", 1},
		{"loop body", "effect function f() {\n  for (const n of [1, 2]) { fork Effect.succeed(n) }\n  return 0\n}", 1},
		{"loop body without braces", "effect function f() {\n  for (const n of [1, 2]) fork Effect.succeed(n)\n  return 0\n}", 1},
		{"loop body without braces that continues", "effect function f() {\n  for (const n of [1, 2]) if (n > 1) continue; else fork Effect.succeed(n)\n  return 0\n}", 1},
		{"loop body and function body", "effect function f() {\n  fork Effect.succeed(0)\n  for (const n of [1, 2]) { fork Effect.succeed(n) }\n  return 0\n}", 2},
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
	virtual := Project(`export const f = effect (): number!! => join (fork Effect.succeed(1))`, testContext).Text
	assert.Assert(t, strings.Contains(virtual, "$scoped(fork)"), virtual)
}

// TestEmitCorpusSyntax catches a lowered scope losing its statement braces
// or separator before else, both of which single-file transpilation recovers.
func TestEmitCorpusSyntax(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"scopes-using"} {
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
// outside the private Scope (D14, D57).
func TestEmitScopedContract(t *testing.T) {
	t.Parallel()
	ctx := testContext
	js, _, diagnostics := Emit("effect function f(): string!infer E { const r = fork lease(1); return \"x\" }", ctx)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "$region(($scope) => $gen(function* () {"), js)
	assert.Assert(t, !strings.Contains(js, "f$fast"), js)
}

// TestEmitLoopRegions checks that iteration pulls rather than collecting,
// and that loop callbacks propagate returns and labeled exits (D26).
func TestEmitLoopRegions(t *testing.T) {
	t.Parallel()
	source := `effect function f(xs: number[]) {
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

// TestEmitProducerCleanup makes native generator finalizers, here a using's
// disposal, part of the producer Effect's exit, including interruption after
// an early pull.
func TestEmitProducerCleanup(t *testing.T) {
	t.Parallel()
	source := `effect function* values() { using r = lease(1); yield 1; yield 2 }`
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	// using is TypeScript's (VIP-8): it opens no Effect Scope.
	assert.Assert(t, strings.Contains(js, "$produce(() => $producerGen(function* () {"), js)
	assert.Assert(t, strings.Contains(js, "__disposeResources(env_1)"), js)
	assert.Assert(t, strings.Contains(js, "$onExit($gen(() => it)"), js)
	assert.Assert(t, strings.Contains(js, "it.return(undefined)"), js)
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

effect function fail() {
  try Effect.failCause(Cause.fail(new Expected()))
}

effect function defect() {
  try Effect.failCause(Cause.die("defect"))
}

effect function combined() {
  try Effect.failCause(Cause.combine(Cause.fail(new Expected()), Cause.die("combined defect")))
}

effect function value() {
  const cause: unknown = Cause.die("not rethrown")
  return effect { throw cause } catch (e) => e === cause ? "cause object" : "other"
}

effect function caught() {
  return effect {
    try fail()
    return "missing"
  } catch effect (e) => match (e) {
    when Expected: "expected";
    default: throw e;
  }
}

function reasons(outcome: Exit.Exit<unknown, Expected>) {
  return match (outcome) {
    when Exit.Success(let value): ["Success"];
    when Exit.Failure(let cause): mapReasons(cause.reasons, (reason) => reason._tag);
  }
}

export effect function main() {
  return {
    caught: try caught(),
    defect: reasons(try exit(defect())),
    combined: reasons(try exit(combined())),
    escaped: reasons(try exit(fail())),
    value: try value()
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
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	// The same cmd/vibelang-mapper the scope runs, from the same sources:
	// this test links no second copy.
	binary := mapperCLI(t, root)
	dir := t.TempDir()
	for _, c := range []struct {
		source string
		code   string
	}{
		{"function f() { return do { return 1; 2 } }", "EK0204"},
		{"function f() { while (true) { const x = do { break; 1 } } }", "EK0204"},
		{"function f() { while (true) { const x = do { continue; 1 } } }", "EK0204"},
	} {
		source := filepath.Join(dir, "main.vibe")
		assert.NilError(t, os.WriteFile(source, []byte(c.source), 0600))
		printed, printErr := exec.Command(binary, "--print", source).CombinedOutput()
		assert.NilError(t, printErr, "%s", printed)
		assert.Assert(t, strings.Contains(string(printed), "// "+c.code+" at "), "%s", printed)
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

// TestProducerDepthRuntime exercises 100,000 producer elements and checks
// that suspended generator frames remain bounded.
func TestProducerDepthRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is unavailable")
	}
	source := `import { hooks } from "vibelang-runtime/kernel"
effect function* count() { for (let i = 0; i < 100000; i++) yield i }
export effect function scenario() {
 let depth = 0
 hooks.onResume = (fiber): void => { depth = Math.max(depth, fiber._stack.length) }
 let sum = 0
 for try (const n of count()) sum += n
 hooks.onResume = undefined
 return { sum, bounded: depth < 50 }
}`
	js, _, ds := Emit(source, testContext)
	assert.Equal(t, len(ds), 0, "%v", ds)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport { runPromise as runDepthTest } from 'effect/Effect'; console.log(JSON.stringify(await runDepthTest(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	assert.Equal(t, strings.TrimSpace(string(out)), `{"sum":4999950000,"bounded":true}`)
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
export effect function scenario() {
 const zero = try sync(BigDecimal.fromNumberUnsafe(0))
 const codec = try sync(Schema.toCodecJson(Schema.String))
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
export effect function scenario() {
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
effect function returned(b: Box): number!! {
 return match (b.state) { when "a": 1; when "b": 2; when "c": 3; }
}
effect function expression(b: Box): number!! {
 const n = match (b.state) { when "a": 1; when "b": 2; when "c": 3; }
 return n
}
effect function statement(b: Box): number!! {
 let n = 0
 match (b.state) { when "a": n = 1; when "b": n = 2; when "c": n = 3; }
 return n
}
effect function either(b: Box): boolean!! {
 return b.state is "a" or "b"
}
export effect function scenario() {
 const r = box(), e = box(), s = box(), i = box()
 return [try returned(r), r.reads, try expression(e), e.reads, try statement(s), s.reads, try either(i), i.reads]
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

// VIP-21: the same native generator keeps its iterator and finally body.
func TestEmitNativeGeneratorCleanup(t *testing.T) {
	source := "function* values() { try { yield 1; return 2 } finally { release() } }"
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	assert.Assert(t, strings.Contains(js, "function* values"), js)
	assert.Assert(t, strings.Contains(js, "finally"), js)
	assert.Assert(t, !strings.Contains(js, "$produce("), js)
}

// The checking witness narrows native property paths; only execution caches
// observations across arms. Inline is patterns and shared nested objects use
// the same cache, and a subsequent evaluation starts again.
func TestMatchPropertyCache(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	source := `export function scenario(): unknown[] {
 const trace: string[] = []
 const key = "value"
 const child = new Proxy({get value(){trace.push("get");return 1}}, {
  has(target, key): boolean {trace.push("has");return Reflect.has(target, key)}
 })
 const subject = {left: child, right: child}
 const first = match(subject){when {left:{[key]:0}}:false;when {right:{[key]:1}}:true;default:false;}
 const second = child is ({value:0} or {value:1})
 const bound = match(child){when ({value:1} and {let value}):value;default:-1;}
 return [first,second,bound,trace]
}`
	checking := Project(source, testContext)
	assert.Equal(t, len(checking.Diagnostics), 0, "%v\n%s", checking.Diagnostics, checking.Text)
	assert.Assert(t, strings.Contains(checking.Text, ".value === 1"), "%s", checking.Text)
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nconsole.log(JSON.stringify(scenario()))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), "[true,true,1,[\"has\",\"get\",\"has\",\"get\",\"has\",\"get\"]]")
}

func TestProjectedPrimitiveWrappers(t *testing.T) {
	t.Parallel()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	source := `export function scenario(): unknown[] {
 const xs: unknown[] = [new String("x"),new Number(2),new Boolean(false),Object(3n),Object(Symbol.for("x"))]
 return xs.map(s => match(s) {
  when String(let x): ["string",x];
  when Number(let x): ["number",x];
  when Boolean(let x): ["boolean",x];
  when BigInt(let x): ["bigint",String(x)];
  when Symbol(let x): ["symbol",String(x)];
  default: "miss";
 })
}`
	projected := Project(source, testContext)
	assert.Equal(t, len(projected.Diagnostics), 0, "%v", projected.Diagnostics)
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nconsole.log(JSON.stringify(scenario()))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), "[[\"string\",\"x\"],[\"number\",2],[\"boolean\",false],[\"bigint\",\"3\"],[\"symbol\",\"Symbol(x)\"]]")
}
