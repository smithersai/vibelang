package vibelangmapper

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// forms looks callee up in the embedded table and fails the test when the
// table has no answer.
func forms(t *testing.T, callee string, argc int) Forms {
	t.Helper()
	f, ok := FormsFor(callee, argc)
	if !ok {
		t.Fatalf("FormsFor(%q, %d): no answer", callee, argc)
	}
	return f
}

func TestFormsForEffectForEach(t *testing.T) {
	// forEach(self, f, options?) and forEach(f, options?): with two
	// arguments the data-first form ranks first and takes an Effect
	// function second; the data-last form disagrees there.
	f := forms(t, "effect/Effect#forEach", 2)
	if f.Callee != "effect/Effect#forEach" || len(f.Candidates) != 2 || f.Candidates[0].Min != 2 {
		t.Fatalf("candidates = %+v", f)
	}
	if f.Params[1].Top != ClassEffectFn || f.Agree[1] {
		t.Errorf("argument 1 = %v, agree %v; want E from the data-first form, candidates disagreeing", f.Params[1].Top, f.Agree[1])
	}
	// An import of the root, a D151 prelude name, and the prelude's Effect
	// all lead to the same key.
	for _, written := range []string{"effect#Effect.forEach", "prelude#forEach", "prelude#Effect.forEach", "vibelang-runtime#Effect.forEach"} {
		if g := forms(t, written, 2); g.Callee != "effect/Effect#forEach" {
			t.Errorf("%s leads to %s", written, g.Callee)
		}
	}
}

func TestFormsForEffectRetry(t *testing.T) {
	// retry(self, policy): the self is a program in every data-first
	// overload; the policy is an options object, a Schedule, or a
	// function, so the overloads disagree on argument 1.
	f := forms(t, "effect/Effect#retry", 2)
	if len(f.Candidates) != 3 || !f.Candidates[0].DataFirst {
		t.Fatalf("candidates = %+v", f.Candidates)
	}
	if f.Params[0].Top != ClassProgram || !f.Agree[0] {
		t.Errorf("argument 0 = %v agree %v, want P agreed", f.Params[0].Top, f.Agree[0])
	}
	if f.Agree[1] || f.Agreed() {
		t.Error("the policy overloads should disagree on argument 1")
	}
	if c := f.Params[1].Props["while"]; c != ClassEffectFn|ClassPlainFn {
		t.Errorf("options.while = %v, want EF (a predicate or an Effect predicate)", c)
	}
}

func TestFormsForEffectTimeout(t *testing.T) {
	f := forms(t, "effect/Effect#timeout", 2)
	if !f.Agreed() || f.Params[0].Top != ClassProgram || !f.Candidates[0].DataFirst {
		t.Errorf("timeout(self, duration) = %+v", f)
	}
	g := forms(t, "effect/Effect#timeout", 1)
	if len(g.Candidates) != 1 || !g.Candidates[0].DataLast || g.Params[0].Top != 0 {
		t.Errorf("timeout(duration) = %+v, want the data-last form, a plain duration", g)
	}
}

func TestFormsForArrayPrototypeMapAbsent(t *testing.T) {
	// Array is JavaScript's global in a .vibe file (D146), and a method
	// of a value has no key: the table has nothing to say.
	for _, key := range []string{"prelude#Array.prototype.map", "prelude#Array.from", "Array.prototype.map"} {
		if f, ok := FormsFor(key, 1); ok {
			t.Errorf("FormsFor(%q) = %+v, want no answer", key, f)
		}
	}
	// effect's own Array.map is a different callee, and takes a plain callback.
	if f := forms(t, "effect/Array#map", 2); f.Params[1].Top != ClassPlainFn {
		t.Errorf("effect/Array#map callback = %v, want F", f.Params[1].Top)
	}
	// xs.map has no key, but every receiver with a map method takes a
	// plain callback, so the method table answers.
	r := resolve(t, `export function f(xs: number[]) { return xs.map((x) => String(x)) }`)
	d := r.lambda(t, "(x) =>")
	if d.Callee.Kind != CalleeNone || d.Provenance != FromTable || d.Form != FormPlain || !strings.HasPrefix(d.Note, "method map") {
		t.Errorf("xs.map's lambda = %+v, want no key, the method table, plain", d)
	}
}

func TestFormsForLayerEffect(t *testing.T) {
	f := forms(t, "effect/Layer#effect", 2)
	if f.Params[1].Top != ClassProgram {
		t.Errorf("Layer.effect(key, program) argument 1 = %v, want P", f.Params[1].Top)
	}
	g := forms(t, "prelude#Layer.effect", 1)
	if !g.Candidates[0].DataLast {
		t.Error("Layer.effect(key) should be data-last: it returns a function of the program")
	}
}

func TestFormsForItEffect(t *testing.T) {
	f := forms(t, "@effect/vitest#it.effect", 2)
	if f.Params[1].Top != ClassEffectFn {
		t.Errorf("it.effect(name, self) argument 1 = %v, want E", f.Params[1].Top)
	}
}

func TestFormsForEffectAll(t *testing.T) {
	// Effect.all([a, b]) and Effect.all({ a, b }): elements and properties
	// are programs (D49); the argument itself is not.
	f := forms(t, "effect/Effect#all", 1)
	if p := f.Params[0]; p.Top != 0 || p.Elem != ClassProgram || p.AnyProp != ClassProgram {
		t.Errorf("all's argument = %+v, want elements and properties P", p)
	}
	if c := f.Params[0].At([]PathStep{{Element: true}}); c != ClassProgram {
		t.Errorf("At(element) = %v", c)
	}
	if c := f.Params[0].At([]PathStep{{Property: "users"}}); c != ClassProgram {
		t.Errorf("At(property) = %v", c)
	}
}

func TestFormsForEffectCatch(t *testing.T) {
	f := forms(t, "effect/Effect#catch", 2)
	if f.Params[0].Top != ClassProgram || f.Params[1].Top != ClassEffectFn || !f.Agreed() {
		t.Errorf("catch(self, f) = %+v, want P, E", f.Params)
	}
	g := forms(t, "effect/Effect#catch", 1)
	if g.Params[0].Top != ClassEffectFn || !g.Candidates[0].DataLast {
		t.Errorf("catch(f) = %+v, want the data-last form taking E", g)
	}
}

func TestFormsForEffectSync(t *testing.T) {
	if f := forms(t, "effect/Effect#sync", 1); f.Params[0].Top != ClassPlainFn {
		t.Errorf("sync(evaluate) = %v, want F", f.Params[0].Top)
	}
	r := resolve(t, `import { Effect } from "effect"
export function f() { return Effect.sync(() => Date.now()) }`)
	if d := r.lambda(t, "() => Date"); d.Form != FormPlain || d.Provenance != FromTable {
		t.Errorf("sync's lambda = %+v, want plain from the table", d)
	}
}

func TestBlockIsTheLastArgument(t *testing.T) {
	// D376: a block is its call's last argument, whatever the callee.
	// withSpan's data-last form takes its options there, never the program.
	r := resolve(t, `export function f() {
  return withSpan("load") {
    return 1
  }
}`)
	d := r.block(t, `withSpan("load")`)
	if !d.Block || d.Form == FormProgram || d.Callee.Canonical != "effect/Effect#withSpan" {
		t.Errorf("withSpan block = %+v, want its last argument, which is not the program", d)
	}
	// Layer.effect(Key) { … }: the data-first form takes the program last.
	r = resolve(t, `service Users { find(id: string): string!! }
export const UsersLive = Layer.effect(Users) {
  return { find(id) { return id } }
}`)
	if d := r.block(t, "Layer.effect(Users)"); d.Form != FormProgram || d.Provenance != FromTable {
		t.Errorf("Layer.effect block = %+v, want a program from the table", d)
	}
	// A block after the pipe topic is the data-first form's last argument.
	r = resolve(t, `import { Effect } from "effect"
export function f() {
  return Effect.succeed({}) |> Effect.bind(%, "value") {
    return 1
  }
}`)
	if d := r.block(t, `Effect.bind(%, "value")`); d.Form != FormEffectFn {
		t.Errorf("bind block after the topic = %+v, want an Effect function", d)
	}
}

func TestEmbeddedTableHeader(t *testing.T) {
	table, err := DefaultTable()
	if err != nil {
		t.Fatal(err)
	}
	h := table.Header
	if h.Notice != "generated; do not edit" || !strings.Contains(h.Command, "check-forms-table.sh") {
		t.Errorf("header = %+v", h)
	}
	pinned := map[string]Input{}
	for _, in := range h.Inputs {
		if _, dup := pinned[in.Package]; dup {
			t.Errorf("%s is pinned twice: the program loaded two copies", in.Package)
		}
		pinned[in.Package] = in
		if len(in.SHA256) != 64 || in.Files == 0 {
			t.Errorf("input %+v has no content hash", in)
		}
	}
	// The generator pins the runtime at its package.json version.
	repo := filepath.Join("..", "..", "..", "..")
	var runtime struct{ Version string }
	data, err := os.ReadFile(filepath.Join(repo, "packages", "runtime", "package.json"))
	if err == nil {
		err = json.Unmarshal(data, &runtime)
	}
	if err != nil {
		t.Fatal(err)
	}
	for pkg, version := range map[string]string{"effect": "4.1.0", "@effect/vitest": "4.1.0", "@effect/platform-node": "4.1.0", "@effect/platform-bun": "4.1.0", "vibelang-runtime": runtime.Version} {
		if pinned[pkg].Version != version {
			t.Errorf("%s pinned at %q, want %s", pkg, pinned[pkg].Version, version)
		}
	}
	// The pins are content, not only versions: recompute each digest from
	// the installed package (docs/tools/node_modules, pinned by its bun.lock)
	// and the runtime's sources.
	nodeModules := os.Getenv("FORMS_NODE_MODULES")
	if nodeModules == "" {
		nodeModules = filepath.Join(repo, "docs", "tools", "node_modules")
	}
	if _, err := os.Stat(filepath.Join(nodeModules, "effect", "package.json")); err != nil {
		t.Skipf("the pinned packages are not installed (%v); set FORMS_NODE_MODULES", err)
	}
	for _, in := range h.Inputs {
		dir, sources := filepath.Join(nodeModules, filepath.FromSlash(in.Package)), false
		if in.Package == "vibelang-runtime" {
			dir, sources = filepath.Join(repo, "packages", "runtime", "src"), true
		}
		files, sum, err := PackageDigest(dir, sources)
		if err != nil {
			t.Errorf("%s: %v", in.Package, err)
			continue
		}
		if files != in.Files || sum != in.SHA256 {
			t.Errorf("%s@%s: installed declarations digest to %d files %s; the table was generated from %d files %s. Run scripts/check-forms-table.sh --write", in.Package, in.Version, files, sum, in.Files, in.SHA256)
		}
	}
	if h.Keys != len(table.Keys()) || h.Aliases != len(table.Aliases()) {
		t.Errorf("header counts %d keys, %d aliases; table has %d, %d", h.Keys, h.Aliases, len(table.Keys()), len(table.Aliases()))
	}
}

// TestTableFormatRoundTrips checks that writing the parsed embedded table
// gives the embedded bytes: the writer is the format's only author.
func TestTableFormatRoundTrips(t *testing.T) {
	table, err := DefaultTable()
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]Signature{}
	for _, k := range table.Keys() {
		entries[k] = table.Signatures(k)
	}
	var buf bytes.Buffer
	if err := WriteTable(&buf, table.Header, table.Modules(), entries, table.Aliases(), table.Values()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), embeddedTable) {
		t.Error("rewriting the embedded table changes its bytes")
	}
}

func TestResolverAliasAndShadowing(t *testing.T) {
	r := resolve(t, `import { Effect as E } from "effect"
import * as Arr from "effect/Array"
export function a() { return E.catch(() => E.succeed(1), (e) => e) }
export function b(names: ReadonlyArray<string>) {
  const forEach = Arr.map
  return forEach(names, (n) => n.length)
}
export function c(names: ReadonlyArray<string>) { return forEach(names, (n) => n.length) }`)
	if d := r.lambda(t, "() => E.succeed"); d.Callee.Canonical != "effect/Effect#catch" || d.Form != FormProgram {
		t.Errorf("E.catch's first lambda = %+v, want a program through the alias", d)
	}
	if d := r.lambda(t, "(e) => e"); d.Form != FormEffectFn {
		t.Errorf("E.catch's handler = %+v, want an Effect function", d)
	}
	shadowed := r.lambdas(t, "(n) => n.length")
	if len(shadowed) != 2 {
		t.Fatalf("found %d lambdas", len(shadowed))
	}
	if d := shadowed[0]; d.Callee.Canonical != "effect/Array#map" || d.Form != FormPlain {
		t.Errorf("the local forEach (Arr.map) lambda = %+v, want plain", d)
	}
	if d := shadowed[1]; d.Callee.Canonical != "effect/Effect#forEach" || d.Form != FormEffectFn {
		t.Errorf("the prelude forEach lambda = %+v, want an Effect function", d)
	}
}

func TestResolverSameFileAnnotations(t *testing.T) {
	// D12: a callback parameter written without a contract accepts any
	// contract, so a lambda passed there is an Effect function; an
	// unannotated parameter says nothing.
	r := resolve(t, `function apply(f: (x: number) => number, g) { return 0 }
function run(p: Effect<number>) { return 0 }
export function main() {
  apply((x) => x + 1, (y) => y)
  run(() => 1)
}`)
	if d := r.lambda(t, "(x) => x + 1"); d.Provenance != FromAnnotation || d.Form != FormEffectFn {
		t.Errorf("written callback = %+v, want an Effect function from the annotation (D12)", d)
	}
	if d := r.lambda(t, "(y) => y"); d.Provenance != FromFallback || d.Form != FormPlain {
		t.Errorf("unannotated parameter = %+v, want the fallback", d)
	}
	if d := r.lambda(t, "() => 1"); d.Provenance != FromAnnotation || d.Form != FormProgram {
		t.Errorf("Effect<number> parameter = %+v, want a program", d)
	}
}

func TestResolverServiceContext(t *testing.T) {
	r := resolve(t, `import { Context } from "effect"
import { Mailer } from "./mailer.vibe"
service Users { find(id: string): string!! }
class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => Effect<string> }>()("Greeter") {}
export const UsersTest = Layer.succeed(Users, { find: (id) => id })
export const GreeterLive = Layer.succeed(Greeter, { greet: (name) => name })
export const MailerTest = Layer.succeed(Mailer, { send: (to) => to })
export const RandomFixed = Effect.provideService(Random.next(), Random.Random, { nextIntUnsafe: () => 4 })`)
	for _, c := range []struct{ text, note string }{
		{"(id) => id", "member Users.find"},
		{"(name) => name", "member Greeter.greet"},
		{"(to) => to", "provider of a service from ./mailer.vibe"},
	} {
		if d := r.lambda(t, c.text); d.Provenance != FromService || d.Form != FormEffectFn || d.Note != c.note {
			t.Errorf("%s = %+v, want an Effect function (%s)", c.text, d, c.note)
		}
	}
	// effect's own Random has plain members: no service context.
	if d := r.lambda(t, "() => 4"); d.Provenance != FromFallback || d.Form != FormPlain {
		t.Errorf("Random.Random member = %+v, want the fallback", d)
	}
}

func TestResolverServiceValueLambdas(t *testing.T) {
	r := resolve(t, `import { Context, Effect, Stream } from "effect"
import { Reference as Ref } from "effect/Context"
const Timings = Ref<(timing: number) => Effect.Effect<void>>("Timings", { defaultValue: () => (initial) => {} })
const Listener = Timings
type PlainListener = (timing: number) => void
const PlainAlias = Context.Reference<PlainListener>("PlainAlias", { defaultValue: () => () => {} })
const Plain = Context.Reference<(timing: number) => void>("Plain", { defaultValue: () => () => {} })
function main() {
  Effect.provideService(Effect.void, Timings, (a) => {})
  Effect.provideService(Timings, (b): void!! => {})
  Stream.provideService(Stream.empty, Listener, (c) => {})
  Stream.provideService(Timings, (d): void!! => {})
  Layer.succeed(Timings, (e) => {})
  Context.make(Timings, (f) => {})
  Context.add(Context.empty(), Timings, (g) => {})
  provide Timings = (h) => {} { return 1 }
  Effect.provideService(Effect.void, Plain, (plain) => {})
  Effect.provideService(Effect.void, PlainAlias, (aliased) => {})
}`)
	for _, text := range []string{"(initial) =>", "(a) =>", "(b):", "(c) =>", "(d):", "(e) =>", "(f) =>", "(g) =>", "(h) =>"} {
		if d := r.lambda(t, text); d.Form != FormEffectFn || d.Provenance != FromService {
			t.Errorf("%s = %+v, want an Effect function from the service value", text, d)
		}
	}
	for _, text := range []string{"(plain) =>", "(aliased) =>"} {
		if d := r.lambda(t, text); d.Form != FormPlain || d.Provenance != FromService {
			t.Errorf("%s = %+v, want a plain service function", text, d)
		}
	}
}

func TestResolverByName(t *testing.T) {
	r := resolve(t, `import { Effect } from "effect"
declare function fetchUser(): Effect<number>
export function f() {
  const a = Effect.retry(fetchUser(), { times: 2 })
  const b = fetchUser() |> Effect.timeout(%, "1 second")
  const c = Effect.succeed(fetchUser())
}`)
	if d := r.argument(t, "fetchUser(), { times"); !d.ByName || d.Provenance != FromTable {
		t.Errorf("retry's self = %+v, want by name", d)
	}
	if d := r.argument(t, `%, "1 second"`); !d.ByName {
		t.Errorf("the topic at timeout's self = %+v, want by name", d)
	}
	if d := r.argument(t, "fetchUser())\n"); d.ByName {
		t.Errorf("succeed's value = %+v, want it to run", d)
	}
}

// resolved is a parsed .vibe file and its resolver.
type resolved struct {
	*Resolver
	text string
	file *ast.SourceFile
}

func resolve(t *testing.T, text string) resolved {
	t.Helper()
	table, err := DefaultTable()
	if err != nil {
		t.Fatal(err)
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/test.vibe")}, text, core.ScriptKindTS)
	return resolved{Resolver: NewResolver(file, table), text: text, file: file}
}

// find returns the nodes of kind accepted whose text starts with prefix.
func (r resolved) find(prefix string, accept func(*ast.Node) bool) []*ast.Node {
	var out []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if accept(n) {
			start := n.Pos()
			for start < len(r.text) && (r.text[start] == ' ' || r.text[start] == '\n') {
				start++
			}
			if strings.HasPrefix(r.text[start:], prefix) {
				out = append(out, n)
			}
		}
		n.ForEachChild(visit)
		return false
	}
	r.file.AsNode().ForEachChild(visit)
	return out
}

func isLambdaNode(n *ast.Node) bool {
	return n.Kind == ast.KindArrowFunction || n.Kind == ast.KindFunctionExpression || n.Kind == ast.KindMethodDeclaration
}

func (r resolved) lambdas(t *testing.T, prefix string) []Decision {
	t.Helper()
	var out []Decision
	for _, n := range r.find(prefix, isLambdaNode) {
		out = append(out, r.Lambda(n))
	}
	return out
}

func (r resolved) lambda(t *testing.T, prefix string) Decision {
	t.Helper()
	ds := r.lambdas(t, prefix)
	if len(ds) != 1 {
		t.Fatalf("found %d lambdas starting %q", len(ds), prefix)
	}
	return ds[0]
}

func (r resolved) block(t *testing.T, prefix string) Decision {
	t.Helper()
	calls := r.find(prefix, func(n *ast.Node) bool { return ast.IsCallExpression(n) && formsIsBlockCall(r.text, n) })
	if len(calls) != 1 {
		t.Fatalf("found %d block calls starting %q", len(calls), prefix)
	}
	return r.Block(calls[0])
}

func (r resolved) argument(t *testing.T, prefix string) Decision {
	t.Helper()
	args := r.find(prefix, func(n *ast.Node) bool {
		call, _, _ := formsOwnerCall(n)
		return call != nil && !isLambdaNode(n)
	})
	if len(args) == 0 {
		t.Fatalf("found no argument starting %q", prefix)
	}
	return r.Argument(args[0])
}

func TestResolverLambdaReturnAnnotation(t *testing.T) {
	// Where the call gives no class (here a function from another file), a lambda's own return annotation
	// decides: a plain type keeps it plain, a contract makes it an Effect
	// function. Without one, the call outside tail position decides.
	r := resolve(t, `import { apply } from "./other.vibe"
function double(x: number): number { return x * 2 }
export function f() {
  const a = apply((x): number => double(x) + 1)
  const b = apply((x): number!! => double(x) + 1)
  const c = apply((x) => double(x) + 1)
}`)
	for _, c := range []struct {
		text string
		form Form
		prov Provenance
	}{
		{"(x): number =>", FormPlain, FromAnnotation},
		{"(x): number!! =>", FormEffectFn, FromAnnotation},
		{"(x) => double", FormEffectFn, FromFallback},
	} {
		if d := r.lambda(t, c.text); d.Form != c.form || d.Provenance != c.prov {
			t.Errorf("%s = %v from %v, want %v from %v", c.text, d.Form, d.Provenance, c.form, c.prov)
		}
	}
}

func TestResolverSyntaxContexts(t *testing.T) {
	r := resolve(t, `interface LineFile { readLine(): Effect<string | undefined, never, never> }
service Banner {
  text(title: string): string!!
  static make(): Banner!! {
    return { text: (title) => title }
  }
}
class Runner {
  run(name: string, program: () => string!!) { return name }
}
export function f() {
  const tuple = Effect.all([() => 12] as const)
  const file: LineFile = { readLine: () => undefined }
  const made = 3 |> (() => % + 1)
  const runner = new Runner()
  return runner.run("job") {
    return "done"
  }
}`)
	// as const keeps the array an argument of Effect.all: its elements are programs.
	if d := r.lambda(t, "() => 12"); d.Form != FormProgram || d.Provenance != FromTable {
		t.Errorf("element under as const = %+v, want a program from the table", d)
	}
	// A member of an object typed by a written interface or service.
	if d := r.lambda(t, "() => undefined"); d.Form != FormEffectFn || d.Provenance != FromAnnotation {
		t.Errorf("LineFile.readLine = %+v, want an Effect function from the annotation", d)
	}
	if d := r.lambda(t, "(title) => title"); d.Form != FormEffectFn || d.Provenance != FromAnnotation {
		t.Errorf("Banner.text returned by make() = %+v, want an Effect function", d)
	}
	// The topic is a value, not a VibeLang statement.
	if d := r.lambda(t, "() => % + 1"); d.Form != FormPlain {
		t.Errorf("lambda over the topic = %+v, want plain", d)
	}
	// A method of a class this file declares, through new.
	if d := r.block(t, `runner.run("job")`); d.Form != FormEffectFn || d.Provenance != FromAnnotation {
		t.Errorf("runner.run block = %+v, want an Effect function", d)
	}
}

func TestBlockOnAValueIsItsLastArgument(t *testing.T) {
	// semaphore has no key, and the only withPermits that takes one
	// argument is Semaphore's own, which returns a function of the program.
	// The block is the call's last argument (D376), which no receiver's
	// withPermits takes, so the table gives it no class.
	r := resolve(t, `export function f() {
  const semaphore = Semaphore.make(1)
  return semaphore.withPermits(1) {
    return "guarded"
  }
}`)
	d := r.block(t, "semaphore.withPermits(1)")
	if d.Class != 0 || d.Provenance != FromFallback {
		t.Errorf("semaphore.withPermits block = %+v, want no class from the method table", d)
	}
}

func TestResolverReceiverModule(t *testing.T) {
	// catchTag and timeoutOrElse take an Effect function on an Effect and a
	// plain one on a Stream. Scope names the Stream receiver three ways: a
	// written type, a value export, and a call whose result the table
	// records. A top-level Effect call names an Effect receiver.
	r := resolve(t, `export function recover(source: Stream.Stream<string, "NotReady">) {
  return source.catchTag("NotReady", () => Stream.succeed("pending"))
}
export const idle = Stream.never.timeoutOrElse({ duration: "1 second", orElse: () => Stream.make("a") })
export const boundary = Stream.die("x").catchDefect(() => Stream.succeed("unreadable"))
export const bumped = Effect.succeed(1).flatMap((n) => Effect.succeed(n + 1))`)
	for _, c := range []struct {
		text string
		form Form
		note string
	}{
		{`() => Stream.succeed("pending")`, FormPlain, "method catchTag of effect/Stream"},
		{`() => Stream.make("a")`, FormPlain, "method timeoutOrElse of effect/Stream"},
		{`() => Stream.succeed("unreadable")`, FormPlain, "method catchDefect of effect/Stream"},
		{"(n) => Effect.succeed", FormEffectFn, "method flatMap of effect/Effect"},
	} {
		if d := r.lambda(t, c.text); d.Form != c.form || d.Note != c.note {
			t.Errorf("%s = %v (%s), want %v (%s)", c.text, d.Form, d.Note, c.form, c.note)
		}
	}
}

func TestResolverNeedsAChoice(t *testing.T) {
	r := resolve(t, `import { route } from "./helpers.ts"
const hooks: { onResume?: (n: number) => void } = {}
let maxDepth = 0
function double(x: number): number { return x * 2 }
export function f(obj, xs: number[], socket) {
  hooks.onResume = (depth) => { maxDepth = Math.max(maxDepth, depth) }
  const a = obj.map((x) => double(x) + 1)
  const b = xs.map((x) => double(x) + 1)
  const c = route((request) => { log(request); return request })
  const d = (() => { log("now"); return 1 })()
  const e = obj.map((x): number => double(x) + 1)
  const g = obj.map((x) => x + 1)
  socket.once("connect") {
    socket.destroy()
    log("closed")
  }
}`)
	choice := func(prefix string) *Choice { return r.lambda(t, prefix).Choice }
	if c := choice("(depth) =>"); c == nil || c.Callee != "" || c.Path != "assigned to hooks.onResume" || c.Plain != "(depth): T =>" || c.Effect != "(depth): T!! =>" {
		t.Errorf("free lambda a host calls: choice = %+v", c)
	} else if got, want := c.Message(), "Cannot tell whether the lambda assigned to hooks.onResume is a plain function or an Effect function: no call gives it a form, and a host that calls it may ignore what it returns. Write `(depth): T =>` for a plain function or `(depth): T!! =>` for an Effect function."; got != want {
		t.Errorf("message = %q\nwant      %q", got, want)
	}
	if c := choice("(x) => double(x) + 1)\n  const b"); c == nil || c.Callee != "obj.map" || c.Path != "argument 1" || c.Reason != "the receiver of map is a value whose type this file does not name" {
		t.Errorf("method of an unnamed receiver: choice = %+v", c)
	}
	if d := r.lambdas(t, "(x) => double(x) + 1")[1]; d.Choice != nil || d.Form != FormPlain || d.Note != "method map of lib/Array" {
		t.Errorf("xs: number[] names the receiver; decision = %+v", d)
	}
	if c := choice("(request) =>"); c == nil || c.Callee != "route" || !strings.Contains(c.Reason, "another file") {
		t.Errorf("function from another file: choice = %+v", c)
	}
	for _, prefix := range []string{`() => { log("now")`, "(x): number =>", "(x) => x + 1"} {
		if c := choice(prefix); c != nil {
			t.Errorf("%s: invoked, annotated, or not pausing, yet choice = %+v", prefix, c)
		}
	}
	d := r.block(t, `socket.once("connect")`)
	if d.Choice == nil || d.Choice.Path != "its block" || d.Choice.Plain != "(): T => { … }" || d.Choice.Forms[1] != FormDual {
		t.Errorf("block after a method of an unnamed receiver: %+v", d.Choice)
	}
}

func TestGeneratorReadsOptionalRecordsAndEveryModule(t *testing.T) {
	// raceAll(all, options?: { onWinner?: … }): the property walk sees the
	// record through its optional parameter's undefined.
	f := forms(t, "effect/Effect#raceAll", 2)
	if c := f.Params[1].Props["onWinner"]; c != ClassPlainFn {
		t.Errorf("raceAll options.onWinner = %v, want F", c)
	}
	table, err := DefaultTable()
	if err != nil {
		t.Fatal(err)
	}
	if table.Header.Rules != RulesVersion {
		t.Errorf("the table was generated under rules %d; the resolver is at %d: run scripts/check-forms-table.sh --write", table.Header.Rules, RulesVersion)
	}
	modules := map[string]bool{}
	for _, m := range table.Modules() {
		modules[m] = true
	}
	// Every published subpath, not a hand list: a module the corpus never
	// imported, and none of the subpaths the exports map hides.
	for _, m := range []string{"effect", "effect/Effect", "effect/sql", "effect/http/HttpClient", "@effect/platform-node/NodeRuntime", "vibelang-runtime/kernel"} {
		if !modules[m] {
			t.Errorf("module %s is not walked", m)
		}
	}
	// effect's exports map hides internal/*, cli/internal/*,
	// cluster/internal/*, and */index; other internal paths stay published.
	for m := range modules {
		for _, hidden := range []string{"effect/internal/", "effect/cli/internal/", "effect/cluster/internal/"} {
			if strings.HasPrefix(m, hidden) || strings.HasSuffix(m, "/index") {
				t.Errorf("module %s is not published", m)
			}
		}
	}
	if table.Header.Modules != len(table.Modules()) {
		t.Errorf("header counts %d modules; the table lists %d", table.Header.Modules, len(table.Modules()))
	}
}

func TestShapeFitNeverDefaultsToTheFirstCandidate(t *testing.T) {
	// f's two overloads both put a plain function second, so the string
	// rules both out; they disagree on the lambda's position (a program
	// against an Effect function), so overload order must not decide.
	table := NewTable(Header{}, map[string][]Signature{
		"pkg/m#f": {
			{Min: 2, Max: 2, Params: []Param{{Top: ClassProgram}, {Top: ClassPlainFn}}},
			{Min: 2, Max: 2, Params: []Param{{Top: ClassEffectFn}, {Top: ClassPlainFn}}},
		},
		"pkg/m#g": {{Min: 2, Max: 2, Params: []Param{{Top: ClassProgram}, {Top: ClassPlainFn}}}},
	}, nil)
	text := `import { f, g } from "pkg/m"
export function main() {
  f(() => { log(1); log(2) }, "x")
  g(() => 1, "100 millis")
}`
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/test.vibe")}, text, core.ScriptKindTS)
	r := resolved{Resolver: NewResolver(file, table), text: text, file: file}
	d := r.lambda(t, "() => { log")
	if !d.Ambiguous || d.Provenance != FromFallback || d.Choice == nil || !strings.Contains(d.Choice.Reason, "overloads disagree") {
		t.Errorf("disagreeing overloads = %+v, want ambiguous, from the fallback, with a choice", d)
	}
	// One candidate cannot disagree with itself: a string at a class the
	// checks misread (Duration.Input is a union with a function member)
	// still leaves g's only signature to answer.
	if d := r.lambda(t, "() => 1"); d.Ambiguous || d.Form != FormProgram || d.Provenance != FromTable {
		t.Errorf("a single loose candidate = %+v, want its program form", d)
	}
}

func TestResolverWellKnownSymbolMethodsArePlain(t *testing.T) {
	// The language calls a Disposable's [Symbol.dispose]() synchronously
	// (D94) and an iterable's [Symbol.iterator](), and uses what they
	// return: plain, not the dual a parameterless method with a call gets.
	r := resolve(t, `const events: string[] = []
function timer(name: string) {
  return {
    name,
    [Symbol.dispose]() {
      events.push("dispose " + name)
    },
    [Symbol.iterator]: () => events.values(),
  }
}
function shadowed() {
  const Symbol = { dispose: "d" }
  return { [Symbol.dispose]() { events.push("x") } }
}`)
	for _, prefix := range []string{"[Symbol.dispose]() {\n      events", "() => events.values()"} {
		if d := r.lambda(t, prefix); d.Form != FormPlain || d.Provenance != FromProtocol {
			t.Errorf("%q = %v from %v, want plain from the protocol", prefix, d.Form, d.Provenance)
		}
	}
	// A local Symbol is not the global one.
	if d := r.lambda(t, `[Symbol.dispose]() { events.push("x") }`); d.Provenance == FromProtocol {
		t.Errorf("a shadowed Symbol = %+v, want no protocol", d)
	}
}

func TestResolverHandleClausesAreEffectFunctions(t *testing.T) {
	// handle(program, Control, clauses): the runtime's Clauses<S, H> is a
	// mapped type, whose template the generator reads, so every clause is an
	// Effect function, even one whose body pauses nowhere.
	f := forms(t, "vibelang-runtime#handle", 3)
	if c := f.Params[2].AnyProp; c != ClassEffectFn {
		t.Errorf("handle's clauses = %v, want E for every member", c)
	}
	r := resolve(t, `control Ask { ask(question: string): number!! }
export function stopEarly() {
  return handle(() => Ask.ask("stop"), Ask, {
    ask(question, _k) { return 0 }
  })
}
export function arrow() {
  return handle(() => Ask.ask("go"), Ask, { ask: (question, k) => resume(k, question.length) })
}`)
	for _, prefix := range []string{"ask(question, _k)", "(question, k) => resume"} {
		if d := r.lambda(t, prefix); d.Form != FormEffectFn || d.Provenance != FromTable || d.Choice != nil {
			t.Errorf("%q = %+v, want an Effect function from the table", prefix, d)
		}
	}
}

func TestResolverNoSilentDefaults(t *testing.T) {
	r := resolve(t, `import { attach } from "./helpers.ts"
const events: string[] = []
export function f(emitter) {
  const a = attach((x) => x + 1)
  emitter.on("start", () => events.push("started"))
  emitter.on("tick", () => log("tick"))
  const half = (n: number): number => { if (n < 0) throw "negative"; return n / 2 }
}`)
	// attach(f: (x) => Effect<number>) and a trusted attach(f: (x) => number)
	// give different results; a pure body cannot say which the user means.
	if c := r.lambda(t, "(x) => x + 1").Choice; c == nil || !strings.Contains(c.Reason, "another file") {
		t.Errorf("a lambda passed to another file's function: choice = %+v", c)
	}
	// The dual would defer events.push, which a host that ignores the result
	// never runs; log returns an Effect, so the dual is safe there.
	if c := r.lambda(t, `() => events.push`).Choice; c == nil || c.Forms[1] != FormDual {
		t.Errorf("a dual over a plain call: choice = %+v", c)
	}
	if d := r.lambda(t, `() => log("tick")`); d.Choice != nil || d.Form != FormDual {
		t.Errorf("a dual over an Effect call = %+v, want the dual with no choice", d)
	}
	// D263: a throw under a plain annotation is JavaScript.
	if d := r.lambda(t, "(n: number): number =>"); d.Choice != nil || d.Form != FormPlain {
		t.Errorf("a plain annotation over a throw = %+v, want plain without a choice", d)
	}
}

// D263: both written return annotations and contextual plain contracts keep
// JavaScript lambdas; plain callback parameters do not gain D12 channels.
func TestResolverPlainContracts(t *testing.T) {
	r := resolve(t, `export const validate = (text: string): string => { if (!text) throw new Error("empty"); return text }
export const contextual: (text: string) => string = (value) => { if (!value) throw new Error("empty"); return value }
export const apply = (build: (payload: Readonly<Record<string, unknown>>) => string, payload: Readonly<Record<string, unknown>>): string => build(payload)
export const line = apply((payload) => String(payload.label), { label: "x" })`)
	for _, prefix := range []string{"(text: string): string =>", "(value) =>", "(payload) =>"} {
		if d := r.lambda(t, prefix); d.Form != FormPlain || d.Choice != nil {
			t.Errorf("%q = %+v, want plain without a choice", prefix, d)
		}
	}
}

func TestResolverHatchTypeScriptIsPlain(t *testing.T) {
	// A hatch's first argument is TypeScript (D148): lambdas inside it are
	// plain at any depth, even where the defaults would make a dual.
	r := resolve(t, `export function f() {
  const doubled = sync(() => [1, 2, 3].map((n) => n * 2))
  const later = callback((resume) => {
    const timer = setTimeout(() => resume(7), 1)
    return () => clearTimeout(timer)
  })
  const finalizer = callback((_resume) => Effect.sync(() => {}))
}
export function h() {
  const callback = (f: () => number) => f()
  return callback(() => 42)
}
export function g() {
  const sync = (f: () => number) => f()
  return sync(() => [1].map((n) => n + 1))
}`)
	for _, prefix := range []string{"(n) => n * 2", "() => resume(7)", "() => clearTimeout", "(resume) =>", "(_resume) =>", "() => {}"} {
		if d := r.lambda(t, prefix); d.Form != FormPlain || d.Provenance != FromHatch {
			t.Errorf("%q = %v from %v, want plain from the hatch", prefix, d.Form, d.Provenance)
		}
	}
	// S19-30: returning an Effect cannot turn a lexical registration into an
	// Effect function, and a local callback still follows its own contract.
	if d := r.lambda(t, "() => 42"); d.Provenance == FromHatch {
		t.Errorf("a shadowed callback = %+v, want no hatch", d)
	}
	// A local sync is not the hatch.
	if d := r.lambda(t, "(n) => n + 1"); d.Provenance == FromHatch {
		t.Errorf("a shadowed sync = %+v, want no hatch", d)
	}
	// catchTags' handler record: an intersection whose mapped member types
	// every handler as an Effect function.
	if c := forms(t, "effect/Effect#catchTags", 2).Params[1].AnyProp; c != ClassEffectFn {
		t.Errorf("catchTags' cases = %v, want E", c)
	}
}

func TestConditionalReturnsNameTheirModule(t *testing.T) {
	// forkScoped returns [Arg] extends [Effect] ? Effect<Fiber> : (self:
	// Effect) => Effect<Fiber>; Effect.all returns All.Return, a
	// conditional over Effect shapes. Both branches agree on effect/Effect.
	for _, key := range []string{"effect/Effect#forkScoped", "effect/Effect#forkChild", "vibelang-runtime#fork", "effect/Effect#all"} {
		f := forms(t, key, 1)
		for _, s := range f.Candidates {
			if s.Result != "effect/Effect" {
				t.Errorf("%s returns %q, want effect/Effect", key, s.Result)
			}
		}
	}
	// A data-last signature's own function result names no module.
	if f := forms(t, "effect/Effect#catch", 1); f.Candidates[0].Result != "" {
		t.Errorf("catch(f) returns %q, want no module", f.Candidates[0].Result)
	}
	// So the dual over fork(…) is safe: no choice.
	r := resolve(t, `service Audit { record(event: string): void!! }
export const background = () => fork(() => Audit.record("background"))`)
	if d := r.lambda(t, "() => fork("); d.Choice != nil || d.Form != FormDual {
		t.Errorf("() => fork(…) = %+v, want the dual with no choice", d)
	}
}
