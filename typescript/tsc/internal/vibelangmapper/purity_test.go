package vibelangmapper

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// purityOf returns the purity of source's functions by name, as
// "pure", "plain" (looks plain, not provably pure), or "effect".
func purityOf(t *testing.T, source string) map[string]string {
	t.Helper()
	got := map[string]string{}
	for _, f := range Project(source, testContext).Purity {
		assert.Assert(t, !f.ProvablyPure || f.PlainLooking, "%s is pure but not plain-looking", f.Name)
		assert.Equal(t, source[f.NameStart:f.NameEnd], f.Name)
		assert.Assert(t, strings.HasPrefix(source[f.Start:f.End], "function") || strings.HasPrefix(source[f.Start:f.End], "export"))
		switch {
		case f.ProvablyPure:
			got[f.Name] = "pure"
		case f.PlainLooking:
			got[f.Name] = "plain"
		default:
			got[f.Name] = "effect"
		}
	}
	return got
}

// TestPurityPlainFunctions checks the shapes of the plain-functions case,
// written as effect functions: a pure helper, one that calls a method of a
// value, one that calls an unmarked function, and functions that run
// Effects. Unmarked functions are plain JavaScript and are not listed.
func TestPurityPlainFunctions(t *testing.T) {
	t.Parallel()
	source := `import { Effect } from "effect"
const order: string[] = []
effect function double(n: number) {
  return n * 2
}
effect function traced(label: string, n: number) {
  order.push(label)
  return n
}
function sumTo(n: number): number {
  return n === 0 ? 0 : n + sumTo(n - 1)
}
function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1)
}
function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1)
}
effect function parity(n: number) {
  return isEven(n) ? "even" : "odd"
}
effect function area(w: number, h: number) {
  const scaled = (try traced("w", try double(w))) * (try traced("h", try double(h)))
  try Effect.sleep("1 millis")
  return scaled
}
effect function maps(xs: ReadonlyArray<number>) {
  const doubled = xs.map((x) => x * 2)
  const viaEffect = try Effect.forEach(xs, double)
  return { doubled, viaEffect }
}
export effect function main() {
  return { sum: sumTo(1000), parity: try parity(10), area: try area(2, 3), order, maps: try maps([1, 2]) }
}
`
	assert.DeepEqual(t, purityOf(t, source), map[string]string{
		"double": "pure",
		"traced": "plain",
		"parity": "plain",
		"area":   "effect",
		"maps":   "effect",
		"main":   "effect",
	})
}

// TestPurityCh13Plain checks the shapes of ch13-plain: a pure effect
// helper, recursion that runs its own call under try, a method of a value,
// a service member, and an unmarked function, which is not listed.
func TestPurityCh13Plain(t *testing.T) {
	t.Parallel()
	source := `service Settings {
  scale(): Effect<number, never, never>
}
const order: string[] = []
effect function double(n: number) {
  return n * 2
}
effect function area(w: number, h: number) {
  return (try double(w)) * (try double(h)) * try (try Settings).scale()
}
effect function tracedDouble(n: number) {
  order.push(` + "`double ${n}`" + `)
  return n * 2
}
effect function tracedArea(w: number, h: number) {
  return (try tracedDouble(w)) * (try tracedDouble(h)) * try (try Settings).scale()
}
effect function sumTo(n: number): Effect<number, never, never> {
  return n === 0 ? 0 : n + try sumTo(n - 1)
}
function doubleAll(xs: ReadonlyArray<number>) {
  return xs.map((x) => x * 2)
}
effect function scale(xs: ReadonlyArray<number>) {
  return doubleAll(xs)
}
export effect function main() {
  return try Effect.provide(effect { return try scale([1, 2]) }, Layer.empty)
}
`
	assert.DeepEqual(t, purityOf(t, source), map[string]string{
		"double":       "pure",
		"area":         "effect",
		"tracedDouble": "plain",
		"tracedArea":   "effect",
		"sumTo":        "effect",
		"scale":        "plain",
		"main":         "effect",
	})
}

// TestPurityNeverOnEffects checks that effect code that names an Effect
// never looks plain: a throw, a try, a using, a fork imported from the
// runtime, and a call of a function that is not plain itself. A for...of
// and a call of another file's function are of unknown purity.
func TestPurityNeverOnEffects(t *testing.T) {
	t.Parallel()
	source := `import { fork } from "vibelang-runtime"
import { helper } from "./helper.vibe"
effect function thrower(n: number) {
  if (n < 0) throw new Error("negative")
  return n
}
effect function tries(n: number) {
  return try helper(n)
}
effect function leases() {
  using r = lease(1)
  return r.id
}
effect function forks() {
  const fiber = fork(helper(1))
  return 1
}
effect function callsThrower(n: number) {
  return thrower(n)
}
effect function loops(xs: ReadonlyArray<number>) {
  let s = 0
  for (const x of xs) s += x
  return s
}
effect function delegates(n: number) {
  return helper(n) * 2
}
`
	assert.DeepEqual(t, purityOf(t, source), map[string]string{
		"thrower":      "effect",
		"tries":        "effect",
		"leases":       "effect",
		"forks":        "effect",
		"callsThrower": "effect",
		"loops":        "plain",
		"delegates":    "plain",
	})
}

// TestEmitPuritySplits checks the D10 output on the corpus's plain-function
// cases: a provably pure effect function gets a direct body and property;
// an unmarked function is plain JavaScript and gets none, and effect
// functions that run Effects keep their Effect wrappers. Both cases write
// their pure helpers unmarked and run every Effect call under try, so
// neither has a direct entry.
func TestEmitPuritySplits(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name   string
		file   string
		pure   []string
		others []string
	}{
		{
			name: "plain-functions", file: "plain-functions/main.vibe",
			others: []string{"double", "traced", "parity", "area", "maps", "main", "sumTo", "isEven", "isOdd"},
		},
		{
			name: "ch13-plain", file: "ch13-plain/ch13-plain.vibe",
			others: []string{"double", "sumTo", "gcd", "area", "tracedDouble", "tracedArea", "doubleAll", "scenario", "main"},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			data, err := os.ReadFile(filepath.Join("../../../vibelang/cases", c.file))
			assert.NilError(t, err)
			js, _, diagnostics := Emit(string(data), testContext)
			assert.Equal(t, len(diagnostics), 0, "diagnostics: %v", diagnostics)
			for _, name := range c.pure {
				assert.Assert(t, strings.Contains(js, "function "+name+"$direct("), "missing direct body for %s in\n%s", name, js)
				// The corpus's comments can reserve $direct, so its import may have an alias.
				assignment := regexp.MustCompile(regexp.QuoteMeta(name) + `\[\$direct(?:_\d+)?\] = ` + regexp.QuoteMeta(name) + `\$direct;`)
				assert.Assert(t, assignment.MatchString(js), "missing direct property for %s in\n%s", name, js)
			}
			for _, name := range c.others {
				assert.Assert(t, !strings.Contains(js, name+"$direct"), "unexpected direct entry for %s in\n%s", name, js)
				assert.Assert(t, !strings.Contains(js, name+"[$direct"), "unexpected direct property for %s in\n%s", name, js)
			}
		})
	}
}

// TestPurityRegressions keeps Effect operations in effect functions out of
// the plain-return warning and keeps export references from hiding direct-call candidates.
func TestPurityRegressions(t *testing.T) {
	for _, c := range []struct{ name, source, want string }{
		{"stream", `effect function f(s) { return Stream.runCollect(s) }`, "effect"},
		{"shadowedService", `effect function f(Stream: any) { return Stream.runCollect() }`, "effect"},
		{"pureModule", `effect function f() { return Option.some(1) }`, "plain"},
		{"layer", `effect function f(l) { return Layer.launch(l) }`, "effect"},
		{"service", `import { FileSystem } from "effect/FileSystem"; effect function f(p) { return FileSystem.realPath(p) }`, "effect"},
		{"rootAlias", `import { FileSystem as fs } from "effect"; effect function f(p) { return fs.realPath(p) }`, "effect"},
		{"platformAlias", `import { NodeFileSystem as fs } from "@effect/platform-node"; effect function f() { return fs.layer() }`, "effect"},
		{"try", `effect function f() { return try g() }`, "effect"},
		{"tryParameterDefault", `const k = Effect.succeed("m"); effect function f(s: string = try k) { return s }`, "effect"},
		{"suspend", `import { suspend } from "vibelang-runtime"; effect function f() { return suspend(() => {}) }`, "effect"},
		{"handoff", `import { handoff } from "vibelang-runtime"; effect function f() { return handoff(() => g(), () => g()) }`, "effect"},
		{"attempt", `import { attempt } from "vibelang-runtime"; effect function f() { return attempt(() => g()) }`, "effect"},
		{"throwExpression", `effect function f(x) { return x ?? throw new Error() }`, "effect"},
		{"doExpression", `effect function f() { return do { try Effect.log("hi") } }`, "effect"},
		{"arrow", `effect function f() { return (() => { Effect.log("hi") })() }`, "effect"},
		{"expression", `effect function f() { return (function () { throw new Error() })() }`, "effect"},
		{"export", `effect function f(xs: number[]) { return xs.at(0) } export { f }`, "plain"},
		{"exportPure", `effect function f(x: number) { return x * 2 } export { f }`, "pure"},
		{"exportAlias", `effect function f(x: number) { return x * 2 } export { f as twice }`, "pure"},
		{"nested", `effect function f() { const g = effect () => { throw new Error() }; return 1 }`, "plain"},
		{"nestedPlain", `effect function f() { const g = () => { throw new Error() }; return 1 }`, "pure"},
	} {
		t.Run(c.name, func(t *testing.T) {
			assert.DeepEqual(t, purityOf(t, c.source), map[string]string{"f": c.want})
		})
	}
}

// TestPurityCorpus records all case functions and checks that executable
// direct entries agree with the purity decision, including exported names.
func TestPurityCorpus(t *testing.T) {
	var files []string
	err := filepath.WalkDir("../../../vibelang/cases", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".vibe") {
			files = append(files, path)
		}
		return nil
	})
	assert.NilError(t, err)
	var rows []string
	pure, plain, total := 0, 0, 0
	for _, file := range files {
		data, err := os.ReadFile(file)
		assert.NilError(t, err)
		source := string(data)
		result := Project(source, testContext)
		js, _, diagnostics := Emit(source, testContext)
		for _, f := range result.Purity {
			total++
			if f.ProvablyPure {
				pure++
			}
			if f.PlainLooking {
				plain++
			}
			rows = append(rows, fmt.Sprintf("%s:%d:%s %t %t", file, f.Start, f.Name, f.ProvablyPure, f.PlainLooking))
			// The direct entry's name is fresh: f$direct, or f$direct_1 when
			// the file spells f$direct (freshWord).
			direct := regexp.MustCompile(`function ` + regexp.QuoteMeta(f.Name+"$direct") + `(_\d+)?\(`)
			assert.Equal(t, direct.MatchString(js), f.ProvablyPure, "%s: %s; executable diagnostics=%+v emittedBytes=%d", file, f.Name, diagnostics, len(js))
		}
	}
	t.Logf("corpus: functions=%d ProvablyPure=%d PlainLooking=%d", total, pure, plain)
	if output := os.Getenv("VIBELANG_PURITY_SNAPSHOT"); output != "" {
		assert.NilError(t, os.WriteFile(output, []byte(strings.Join(rows, "\n")+"\n"), 0600))
	}
}
