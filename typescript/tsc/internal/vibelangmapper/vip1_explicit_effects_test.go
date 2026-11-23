package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// The projector follows the explicit language (VIP-1, VIP-5, VIP-8): a
// function is an Effect function only when written effect, a call runs only
// under try, and everything else is the TypeScript written. These rows are
// the programs of issues #457 and #515, each with the text stock TypeScript
// reads and the diagnostics the projector reports, which are the native
// compiler's.
var explicitEffectCases = []struct {
	name        string
	source      string
	virtual     string
	diagnostics []Diagnostic
}{
	{
		name:    "a function with no modifier is plain",
		source:  "function plain() { return 1 }\nexport const n: number = plain()\n",
		virtual: "function plain() { return 1 }\nexport const n: number = plain()\n",
	},
	{
		name:    "a lambda with no modifier is plain, and its calls are values",
		source:  "export const next = (o: Option.Option<number>) => Option.getOrNull(Option.map(o, (n) => n + 1))\nexport const k: number | null = next(Option.some(1))\n",
		virtual: "export const next = (o: Option.Option<number>) => Option.getOrNull(Option.map(o, (n) => n + 1))\nexport const k: number | null = next(Option.some(1))\n",
	},
	{
		name:    "a lambda in a position that takes an Effect is still plain",
		source:  "export effect function f() { return try retry(() => load(), { times: 2 }) }\n",
		virtual: "export        function f() { return $gen(function* () { return     (yield* $run($try(retry(() => load(), { times: 2 })))) })}\n",
	},
	{
		name:    "an untried call returns its Effect unrun",
		source:  "effect function load(id: number) { return id }\nexport effect function main() { const e = load(1); const n: number = e; return n }\n",
		virtual: "       function load(id: number) { return $gen(function* () { return id })}\nexport        function main() { return $gen(function* () { const e = load(1); const n: number = e; return n })}\n",
	},
	{
		name:    "try runs a call, a held Effect and an argument's Effect",
		source:  "effect function load(id: number) { return id }\nexport effect function main() { const e = load(1); return (try e) + (try load(try load(2))) }\n",
		virtual: "       function load(id: number) { return $gen(function* () { return id })}\nexport        function main() { return $gen(function* () { const e = load(1); return ((yield* $run($try(e)))) + (    (yield* $run($try(load(    (yield* $run($try(load(2))))))))) })}\n",
	},
	{
		name:    "a built-in call stays as written",
		source:  "export effect function a(s: string) { return JSON.parse(s) }\nexport function b(d: TextDecoder, bytes: Uint8Array) { return d.decode(bytes) }\n",
		virtual: "export        function a(s: string) { return $gen(function* () { return JSON.parse(s) })}\nexport function b(d: TextDecoder, bytes: Uint8Array) { return d.decode(bytes) }\n",
	},
	{
		name:    "a callback parameter keeps its written type",
		source:  "export effect function each(xs: number[], f: (n: number) => number) { return xs.map(f) }\nexport function plain(xs: number[], f: (n: number) => number) { return xs.map(f) }\n",
		virtual: "export        function each(xs: number[], f: (n: number) => number) { return $gen(function* () { return xs.map(f) })}\nexport function plain(xs: number[], f: (n: number) => number) { return xs.map(f) }\n",
	},
	{
		name:    "a method is an Effect function only when written effect",
		source:  "service Users { find(id: string): string!! }\nclass Memory implements Users {\n  find(id: string) { return succeed(id) }\n  effect load(id: string) { return try this.find(id) }\n}\n",
		virtual: "interface Users { find(id: string): Effect.Effect<string, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Users\" } abstract class Users extends $service<Users>(\"app/src/main#Users\") {}\nclass Memory implements Users {\n  find(id: string) { return succeed(id) }\n         load(id: string) { return $gen({ self: this }, function* () { return     (yield* $run($try(this.find(id)))) })}\n}\n",
	},
	{
		name:    "a member call on a service key reads nothing",
		source:  "service Users { find(id: string): string!! }\nexport effect function f(id: string) { const users = try Users; return try users.find(id) }\nexport function g(id: string) { return Users.find(id) }\n",
		virtual: "interface Users { find(id: string): Effect.Effect<string, never, never>; readonly \"~vibelang/service\"?: \"app/src/main#Users\" } abstract class Users extends $service<Users>(\"app/src/main#Users\") {}\nexport        function f(id: string) { return $gen(function* () { const users = (yield* $run($try(Users))); return     (yield* $run($try(users.find(id)))) })}\nexport function g(id: string) { return Users.find(id) }\n",
	},
	{
		name:    "a plain function's try and finally are JavaScript's",
		source:  "function g(): number { return 1 }\nexport function f(): number {\n  try { g() } finally { return 1 }\n}\n",
		virtual: "function g(): number { return 1 }\nexport function f(): number {\n  try { g() } finally { return 1 }\n}\n",
	},
	{
		name:        "a try statement in effect code is EK0503 and is not lowered",
		source:      "error Boom { why: string }\neffect function risky(): number!Boom { throw new Boom({ why: \"x\" }) }\nexport effect function main() {\n  try { return try risky() } catch (e) { return 0 }\n}\n",
		virtual:     "class Boom extends TaggedError(\"Boom\")<{ readonly why: string }> {}\n       function risky(): Effect.Effect<number, Boom, never> { return $gen(function* () { return yield* $fail(new Boom({ why: \"x\" })) })}\nexport        function main() { return $gen(function* () {\n  try { return     (yield* $run($try(risky()))) } catch (e) { return 0 }\n})}\n",
		diagnostics: []Diagnostic{{Start: 131, Length: 49, Code: CodeEffectTryStatement, Message: effectTryStatementMessage}},
	},
	{
		name:    "a try statement in a plain function nested in effect code is JavaScript's",
		source:  "export effect function main() {\n  const parse = (s: string) => { try { return s.length } finally { done() } }\n  return parse(\"x\")\n}\n",
		virtual: "export        function main() { return $gen(function* () {\n  const parse = (s: string) => { try { return s.length } finally { done() } }\n  return parse(\"x\")\n})}\n",
	},
	{
		name:    "using is TypeScript's",
		source:  "effect function open() { return try acquireRelease(succeed(1), () => succeed(undefined)) }\nexport effect function main() {\n  using r = open()\n  using n = 5\n  return 1\n}\n",
		virtual: "       function open() { return $gen(function* () { return     (yield* $run($try(acquireRelease(succeed(1), () => succeed(undefined))))) })}\nexport        function main() { return $gen(function* () {\n  using r = open()\n  using n = 5\n  return 1\n})}\n",
	},
	{
		name:    "a relative .ts import keeps its extension",
		source:  "import { route } from \"./router.ts\"\nexport { route } from \"./router.ts\"\nexport const r = route\n",
		virtual: "import { route } from \"./router.ts\"\nexport { route } from \"./router.ts\"\nexport const r = route\n",
	},
	{
		name:        "try outside effect code is an error, not a run",
		source:      "function f() { return try g() }\n",
		virtual:     "function f() { return     g() }\n",
		diagnostics: []Diagnostic{{Start: 22, Length: 7, Code: CodeTryPlacement, Message: "A try must run in an Effect body; move it into an effect function or block."}},
	},
}

func TestVIP1ExplicitEffectsProjection(t *testing.T) {
	t.Parallel()
	for _, c := range explicitEffectCases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			projection := Project(c.source, testContext)
			assert.Equal(t, virtualBody(t, projection), c.virtual)
			assert.DeepEqual(t, projection.Diagnostics, c.diagnostics)
			assertValidMap(t, projection, c.source)
			assertParses(t, projection.Text)
			// The retired implicit rewrites never appear for code that does not ask for them.
			for _, helper := range []string{"$use(", "$value(", "$member(", "$trusted", "$adapt(", "$asProgram(", "$programs(", "$dual(", "$acquire(", "$catch(", "$finally(", "$plain"} {
				assert.Assert(t, !strings.Contains(projection.Text, helper), "%s in:\n%s", helper, projection.Text)
			}
		})
	}
}

// The executable rendering renders the same plan: an unmarked function is the
// JavaScript function written, and only try yields.
func TestVIP1ExplicitEffectsExecutable(t *testing.T) {
	t.Parallel()
	js, _, diagnostics := Emit("function plain(n: number) { return n + 1 }\neffect function load(id: number) { return id }\nexport effect function main() { const e = load(1); const n = try load(plain(2)); return [e, n] }\nexport function twice(n: number) { return plain(plain(n)) }\n", testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
	for _, want := range []string{
		"function plain(n) { return n + 1; }",
		"const e = load(1);",
		"const n = $try(load$direct(plain(2)));",
		"export function twice(n) { return plain(plain(n)); }",
	} {
		assert.Assert(t, strings.Contains(js, want), "missing %q in\n%s", want, js)
	}
	for _, unwanted := range []string{"plain$direct", "plain$body", "twice$"} {
		assert.Assert(t, !strings.Contains(js, unwanted), "unexpected %q in\n%s", unwanted, js)
	}
	// Only the executable rendering rewrites a .ts specifier to the JavaScript it names.
	js, _, _ = Emit("import { route } from \"./router.ts\"\nexport const r = route\n", testContext)
	assert.Assert(t, strings.Contains(js, "\"./router.js\""), js)
	// A plain main is called, not run as a program.
	js, _, _ = Emit("export function main() { return 1 }\n", testContext)
	assert.Assert(t, strings.Contains(js, "$runMain($sync(main))") && !strings.Contains(js, "$runMain(main())"), js)
	js, _, _ = Emit("export effect function main() { return 1 }\n", testContext)
	assert.Assert(t, strings.Contains(js, "$runMain(main())"), js)
}

// The editor's form query reports no choice for an unmarked lambda: its form
// is plain. This is the experimental-test-restartable program of issue #457.
func TestVIP1NoFormChoiceForPlainLambda(t *testing.T) {
	t.Parallel()
	source := "const live = Step.toLayer(({ n }) => Effect.as(perform(`step:${n}`), n))\nexport const job = pipe(() => a(), opaque)\n"
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assert.Assert(t, strings.Contains(projection.Text, "Step.toLayer(({ n }) => Effect.as(perform(`step:${n}`), n))"), projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "pipe(() => a(), opaque)"), projection.Text)
}

// vip1StockProject returns a directory that resolves the mapper's prelude and
// effect, and the pinned stock compiler.
func vip1StockProject(t *testing.T) (string, string) {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	dir := t.TempDir()
	assert.NilError(t, os.Symlink(filepath.Join(mapperTestScope(t, root), "node_modules"), filepath.Join(dir, "node_modules")))
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	assert.NilError(t, err)
	for name, body := range map[string]string{
		"package.json": `{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`,
		"prelude.d.ts": string(prelude),
		"router.ts":    "export const route = 1\n",
	} {
		assert.NilError(t, os.WriteFile(filepath.Join(dir, name), []byte(body), 0600))
	}
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	return dir, stock
}

// Stock TypeScript, reading the projection, agrees with the native compiler
// on the programs of issues #457 and #515: it accepts what the native
// compiler accepts and reports the native compiler's error where it rejects.
func TestVIP1StockAgreesWithNative(t *testing.T) {
	for _, c := range []struct {
		name, source string
		// want is the error code the native compiler reports, or "" for none. The
		// pinned stock compiler words a using initializer with no
		// [Symbol.dispose] as TS2741 where the native one says TS2850.
		want string
		// line is the 1-based source line of the error.
		line int
	}{
		{name: "plain function result is its value", source: "function plain() { return 1 }\nexport const n: number = plain()\n"},
		{name: "plain lambda result is its value", source: "export const next = (o: Option.Option<number>) => Option.getOrNull(Option.map(o, (n) => n + 1))\nexport const k: number | null = next(Option.some(1))\n"},
		{name: "plain try finally", source: "function g(): number { return 1 }\nexport function f(): number {\n  try { g() } finally { return 1 }\n}\n"},
		{name: "tried call gives its success", source: "effect function load(id: number) { return id }\nexport effect function main() { const n: number = try load(1); return n }\n"},
		{name: "unrun Effect is not its success", source: "effect function load(id: number) { return id }\nexport effect function main() {\n  const e = load(1)\n  const n: number = e\n  return n\n}\n", want: "TS2322", line: 4},
		{name: "using needs a Disposable", source: "effect function open() { return try Effect.acquireRelease(Effect.succeed(1), () => Effect.succeed(undefined)) }\nexport effect function main() {\n  using r = open()\n  return 1\n}\n", want: "TS2850", line: 3},
		{name: "ts extension needs the option", source: "import { route } from \"./router.ts\"\nexport const r = route\n", want: "TS5097", line: 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir, stock := vip1StockProject(t)
			projection := Project(c.source, testContext)
			assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
			assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600))
			cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			if c.want == "" {
				assert.NilError(t, err, "stock TypeScript rejects what the native compiler accepts:\n%s\n%s", out, projection.Text)
				return
			}
			assert.Assert(t, err != nil, "stock TypeScript accepts what the native compiler rejects with %s:\n%s", c.want, projection.Text)
			// The projection's first line is the prelude import, so a source line is one lower.
			at := "main.ts(" + itoa(c.line+1) + ","
			found := false
			for _, line := range strings.Split(string(out), "\n") {
				found = found || strings.HasPrefix(line, at) && (strings.Contains(line, "error "+c.want+":") || c.want == "TS2850" && strings.Contains(line, "error TS2741:") && strings.Contains(line, "[Symbol.dispose]"))
			}
			assert.Assert(t, found, "want %s on source line %d:\n%s\n%s", c.want, c.line, out, projection.Text)
		})
	}
}

// vip1CasesAhead lists single-file vip1-* compiler cases that stock TypeScript
// does not yet accept through the projection, each with its reason. A listed
// case that starts to pass fails the test, so its line is deleted.
var vip1CasesAhead = map[string]string{
	"vip1-coverage-default-return":  "the mapper still compiles a do expression to a function, so a return in it is EK0204",
	"vip1-coverage-unannotated-any": "the case turns noImplicitAny off in its tsconfig; this check runs --strict",
}

// Each accepting vip1-* compiler case with one .vibe file projects, as
// written, to text the pinned stock compiler accepts with no projector
// diagnostics: the projection applies the rules the native compiler does.
func TestVIP1CasesAgreeWithStock(t *testing.T) {
	dirs, err := filepath.Glob("../../../vibelang/cases/vip1-*")
	assert.NilError(t, err)
	checked := 0
	for _, caseDir := range dirs {
		name := filepath.Base(caseDir)
		vibes, _ := filepath.Glob(filepath.Join(caseDir, "*.vibe"))
		others, _ := filepath.Glob(filepath.Join(caseDir, "*.ts"))
		if strings.HasSuffix(name, ".fail") || len(vibes) != 1 || len(others) != 0 {
			continue
		}
		checked++
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile(vibes[0])
			assert.NilError(t, err)
			dir, stock := vip1StockProject(t)
			projection := Project(string(source), testContext)
			assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600))
			cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			agrees := err == nil && len(projection.Diagnostics) == 0
			if reason, ahead := vip1CasesAhead[name]; ahead {
				assert.Assert(t, !agrees, "stock TypeScript now accepts %s: delete it from vip1CasesAhead (%s)", name, reason)
				t.Logf("pending: %s", reason)
				return
			}
			assert.Assert(t, agrees, "the native compiler accepts %s, but through the projection: %v\n%s\n%s", name, projection.Diagnostics, out, projection.Text)
		})
	}
	if checked == 0 {
		t.Skip("no vip1 cases beside this checkout")
	}
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return itoa(n/10) + string(rune('0'+n%10))
}
