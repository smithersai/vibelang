package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D30, D31 and D365 authorize source module specifiers, not unrelated text.
func TestOutputsSourceSpecifiers(t *testing.T) {
	source := `// "node:comment"
const text = "node:unrelated";
const template = ` + "`node:template`" + `;
import type { A } from "./a.vibe";
export { B } from "./b.ts";
type C = import("./c.ts").C;
const load = () => import("./d.ts");
`
	specifiers := sourceSpecifiers("main.vibe", source)
	for _, name := range []string{"./a.js", "./b.js", "./c.js", "./d.js"} {
		if !specifierWritten(name, specifiers) {
			t.Errorf("D365: source module %q was not authorized", name)
		}
	}
	for _, name := range []string{"node:comment", "node:unrelated", "node:template"} {
		if specifierWritten(name, specifiers) {
			t.Errorf("D30: ordinary string authorized %q", name)
		}
	}
}

// VIP-30's source-spelling rule permits every native declaration suffix and
// rejects only VibeLang-only suffixes in a relative published import.
func TestOutputsDeclarationSourceSpellings(t *testing.T) {
	TestTscDeclarationRulesQuoted(t)
	for _, suffix := range []string{".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", "", ".vibe", ".vibex"} {
		t.Run(suffix, func(t *testing.T) {
			g := &Gaps{}
			text := "export type { T } from \"./user" + suffix + "\";\n"
			(&OutputChecker{G: g}).checkDeclarationText(nil, "main.d.ts", text, nil)
			want := suffix == ".vibe" || suffix == ".vibex"
			if g.Any() != want {
				t.Fatalf("suffix %q: gaps %v; want rejected=%v", suffix, g.found, want)
			}
		})
	}
}

// Chapter 27 and D34 require requested outputs even when the source is .ts.
// Detail 72: a declaration file's module augmentation names the output, as
// its imports do. No declaration sits beside ./x.vibe once it ships, so
// TypeScript reports TS2664 or, under skipLibCheck, drops the augmentation.
func TestOutputsAugmentationName(t *testing.T) {
	for _, tc := range []struct {
		text string
		want bool
	}{
		{"declare module \"./user.vibe\" {\n}\nexport {};\n", true},
		{"declare module \"./user.js\" {\n}\nexport {};\n", false},
		{"declare module \"pkg.vibe\" {\n}\nexport {};\n", false},
	} {
		g := &Gaps{}
		(&OutputChecker{G: g}).checkDeclarationText(nil, "main.d.ts", tc.text, nil)
		if got := g.Any(); got != tc.want {
			t.Errorf("%q: gap %v, want %v", tc.text, got, tc.want)
		}
	}
}

func TestOutputsRequiredFiles(t *testing.T) {
	w := NewWorkspace(t)
	project := Project{Files: map[string]string{
		"main.vibe":   "export function main(n: number) { return n + 1 }\n",
		"ordinary.ts": "export const ordinary = 1;\n",
	}}
	c, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if HasError(c.Diagnostics) {
		t.Fatalf("fixture diagnostics: %v", Keys(c.Dir, c.Diagnostics))
	}
	for _, name := range []string{"out/main.js", "out/main.d.ts", "out/main.js.map", "out/ordinary.js", "out/ordinary.d.ts", "out/ordinary.js.map"} {
		t.Run(name, func(t *testing.T) {
			output, ok := c.Outputs[name]
			if !ok {
				t.Fatalf("fixture did not emit %s", name)
			}
			delete(c.Outputs, name)
			defer func() { c.Outputs[name] = output }()
			g := &Gaps{}
			(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).Check(c)
			key := "feature:missing-js"
			if isDeclaration(name) {
				key = "feature:missing-declaration"
			}
			if strings.HasSuffix(name, ".map") {
				key = "feature:missing-source-map"
			}
			if !slices.ContainsFunc(g.found, func(found gap) bool { return found.key == key }) {
				t.Fatalf("missing %s was not detected: %v", name, g.found)
			}
		})
	}
	t.Run("emit-skipped", func(t *testing.T) {
		c.EmitSkipped = true
		defer func() { c.EmitSkipped = false }()
		g := &Gaps{}
		(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).Check(c)
		if !slices.ContainsFunc(g.found, func(found gap) bool { return found.key == "feature:emit-skipped" }) {
			t.Fatalf("skipped emit was not detected: %v", g.found)
		}
	})
}

// Chapter 27 rules 1 and 4 (D366) exercise calls, aliases and default exports
// of declaration-only modules, including rest, overloaded and generic forms.
func TestOutputsConsumerCalls(t *testing.T) {
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), Single("export function f(n: number) { return n }\n"), OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	c.Outputs["out/main.d.ts"] = `export declare function overloaded(x: string): string;
export declare function overloaded(x: number): number;
export declare function generic<T extends { id: number }>(x: T): T;
export { generic as alias };
export declare const callable: (x: number, ...tail: string[]) => number;
export default function(n: number): number;
`
	g := &Gaps{}
	(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).checkConsumer(c, []string{"out/main.d.ts"})
	if g.Any() {
		t.Fatalf("declaration-only calls failed: %v", g.found)
	}
	data, err := os.ReadFile(filepath.Join(c.Dir, "__declarations/__consumer.mts"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, name := range []string{"overloaded", "generic", "alias", "callable", "default"} {
		if !strings.Contains(text, "[\""+name+"\"](...args") {
			t.Errorf("no declaration consumer call of %s:\n%s", name, text)
		}
	}
	if strings.Count(text, "declare const args") != 5 || strings.Count(text, ": ReturnType<") != 5 {
		t.Errorf("expected five parameter tuples and result assignments:\n%s", text)
	}
}

// D34 maps preserved statements to their own original spans. Swapping valid
// source lines violates correspondence while satisfying a bounds-only oracle.
func TestOutputsStatementCorrespondence(t *testing.T) {
	const source = "export const first = 1;\nexport const second = 2;\n"
	for _, tc := range []struct {
		name, mappings string
		bad            bool
	}{
		{"correct", "AAAA;AACA", false},
		{"swapped", "AACA;AADA", true},
		{"unmapped", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := &Gaps{}
			(&OutputChecker{G: g}).checkStatementMappings("main.js", source, source, 0, SourceMap{Mappings: tc.mappings})
			if g.Any() != tc.bad {
				t.Fatalf("correspondence gaps: %v, want failure %v", g.found, tc.bad)
			}
		})
	}
}

// Chapter 27's helper boundary is executable ESM, even if a declaration
// advertises a value the JavaScript never exports.
func TestOutputsExecutableExports(t *testing.T) {
	dir := t.TempDir()
	for name, text := range map[string]string{
		"package.json": `{"type":"module"}`,
		"node_modules/vibelang-runtime/package.json": `{"type":"module","exports":"./index.js"}`,
		"node_modules/vibelang-runtime/index.js":     "export const actual = 1;\n",
		"node_modules/vibelang-runtime/index.d.ts":   "export declare const fictional: number;\n",
	} {
		if err := writeInside(dir, name, text); err != nil {
			t.Fatal(err)
		}
	}
	w := &Workspace{Dir: dir}
	exports, err := w.ModuleExports(context.Background(), "vibelang-runtime")
	if err != nil {
		t.Fatal(err)
	}
	if !exports["actual"] || exports["fictional"] {
		t.Fatalf("expected executable exports, got %v", exports)
	}
}

// The opt-in probe must execute the stored Chapter 27 hang reproduction;
// normal mutation campaigns keep their size bound and confinement checks.
func TestOutputsHangProbeSize(t *testing.T) {
	project := Single("//" + strings.Repeat("x", 33<<10))
	t.Setenv("VIBELANG_FUZZ_HANG_PROBE", "")
	if Admissible(project) != "too large" {
		t.Fatal("normal size bound missing")
	}
	t.Setenv("VIBELANG_FUZZ_HANG_PROBE", "1")
	if reason := Admissible(project); reason != "" {
		t.Fatalf("hang probe still skips its reproduction: %s", reason)
	}
	project.Config = `{"extends":"../../outside.json"}`
	if reason := Admissible(project); reason == "" {
		t.Fatal("hang probe bypassed confinement")
	}
}

// D266 compares declaration/map emit and exclusive diagnostic ends. The span
// record must distinguish diagnostics whose start, category and code agree.
func TestOutputsParityRecords(t *testing.T) {
	for _, name := range []string{"out/main.js", "out/main.d.ts", "out/main.js.map", "out/main.d.ts.map"} {
		if !parityOutput(name) {
			t.Errorf("D266 output omitted: %s", name)
		}
	}
	a := stockSpan{File: "main.ts", Start: 3, End: 4, Code: 2322, Category: "error"}
	b := a
	b.End++
	if slices.Equal(spanStrings([]stockSpan{a}), spanStrings([]stockSpan{b})) {
		t.Fatal("D266 diagnostic end difference was ignored")
	}
}

// Chapter 13 (D187) allows a do value to lower to a return that is also
// spelled elsewhere. Its mapping belongs to the do value, not that return.
func TestOutputsDoValueMapping(t *testing.T) {
	const source = "function f() {\n  return 1;\n}\nfunction g() {\n  return do {\n    1\n  };\n}\n"
	g := &Gaps{}
	(&OutputChecker{G: g}).checkStatementMappings("main.js", "return 1;\n", source, 0, SourceMap{Mappings: "AAKI"})
	if g.Any() {
		t.Fatalf("D187 do-value mapping rejected: %v", g.found)
	}
	wrong := &Gaps{}
	(&OutputChecker{G: wrong}).checkStatementMappings("main.js", "return 1;\n", source, 0, SourceMap{Mappings: "AAGA"})
	if !wrong.Any() {
		t.Fatal("an unchanged return borrowed an unrelated function's mapping")
	}
}

// This checks the end-position reader against an already-installed stock
// compiler without adding dependencies. The diagnostic's expected span is
// derived from the source binding, in UTF-16 units, including non-ASCII text.
func TestOutputsStockSpans(t *testing.T) {
	tsc := filepath.Join(Root(), "experiments/node_modules/.bin/tsc")
	if _, err := os.Stat(tsc); err != nil {
		t.Skipf("optional installed stock compiler: %v", err)
	}
	w := NewWorkspace(t)
	const source = "// é😀\nexport const answer: number = 'no';\n"
	project := Project{Files: map[string]string{"main.ts": source}}
	c, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	spans, _, err := stockSpans(t.Context(), tsc, c.Dir)
	if err != nil {
		t.Fatal(err)
	}
	start := UTF16Len(source[:strings.Index(source, "answer")])
	expected := stockSpan{File: "main.ts", Start: start, End: start + len("answer"), Code: 2322, Category: "error"}
	if !slices.Contains(spans, expected) {
		t.Fatalf("expected binding diagnostic %v, got %v", expected, spans)
	}
}

// D34's correspondence also survives ordinary TypeScript type erasure; a
// typed declaration must not map to another declaration's otherwise-valid line.
func TestOutputsTypedStatementCorrespondence(t *testing.T) {
	const source = "export const first: number = 1;\nexport const second: number = 2;\n"
	const generated = "export const first = 1;\nexport const second = 2;\n"
	g := &Gaps{}
	(&OutputChecker{G: g}).checkStatementMappings("main.js", generated, source, 0, SourceMap{Mappings: "AACA;AADA"})
	if !g.Any() {
		t.Fatal("D34: type erasure hid swapped declaration mappings")
	}
}

// D307's constructor constant originates in the written data declaration,
// rather than the keyword-only span of a synthetic parser companion (D34).
func TestOutputsDataDeclarationMappings(t *testing.T) {
	const source = "data Delivery { Waiting }\nconst other = 1;\n"
	const generated = "const Delivery = Data.taggedEnum();\n"
	for _, tc := range []struct {
		name, mappings string
		bad            bool
	}{
		{"constructor-name", "AAAK", false},
		{"unrelated-statement", "AACA", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := &Gaps{}
			(&OutputChecker{G: g}).checkStatementMappings("main.js", generated, source, 0, SourceMap{Mappings: tc.mappings})
			if g.Any() != tc.bad {
				t.Fatalf("D307 constructor mapping gaps: %v, want failure %v", g.found, tc.bad)
			}
		})
	}
}

// Gaps collects "so that one pending gap does not hide the other oracles'
// verdicts": a gap another oracle recorded for the input, pending or not,
// must not turn the declaration consumer off (Chapter 27 rule 4, D366).
func TestOutputsConsumerBesideEarlierGap(t *testing.T) {
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), Single("export function f(n: number) { return n }\n"), OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	g := &Gaps{Target: "FuzzCompile"}
	g.Add("feature:order:emit-first:+TS2304", "another oracle's pending gap")
	(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).Check(c)
	if len(g.found) != 1 {
		t.Fatalf("the outputs of a valid program were rejected: %v", g.found)
	}
	if _, err := os.Stat(filepath.Join(c.Dir, "__declarations", consumerModule)); err != nil {
		t.Fatalf("an earlier gap turned the declaration consumer off: %v", err)
	}
}

// Every consumer error is reported, each under its code and the declaration
// it is in: the first error must not hide the second, and one declaration's
// pending line must not excuse another declaration.
func TestOutputsConsumerReportsEveryError(t *testing.T) {
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), Single("export function f(n: number) { return n }\n"), OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	c.Outputs["out/main.d.ts"] = "export declare const first: Absent1;\nexport declare const second: {\n    value: Absent2;\n};\n"
	g := &Gaps{}
	(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).checkConsumer(c, []string{"out/main.d.ts"})
	for _, want := range []string{"feature:declaration-consumer-TS2304:first", "feature:declaration-consumer-TS2304:second"} {
		if !slices.ContainsFunc(g.found, func(found gap) bool { return found.key == want }) {
			t.Errorf("no gap %s: %v", want, g.found)
		}
	}
}

func TestConsumerDeclaration(t *testing.T) {
	const declarations = "import { Effect } from \"effect\";\n/**\n * The first.\n */\nexport declare const first: {\n    value: number;\n};\nexport declare function second(n: number): Effect.Effect<number>;\nexport type Third = typeof first;\nexport { first as alias };\n"
	const consumer = "import * as m0 from \"./out/main.js\"\ndeclare const args0_0: Parameters<typeof m0[\"second\"]>\nexport const result0_0: ReturnType<typeof m0[\"second\"]> = m0[\"second\"](...args0_0)\n"
	for _, tc := range []struct {
		base, text string
		line       int
		want       string
	}{
		{"main.d.ts", declarations, 1, ""},
		{"main.d.ts", declarations, 6, "first"},
		{"main.d.ts", declarations, 7, "first"},
		{"main.d.ts", declarations, 8, "second"},
		{"main.d.ts", declarations, 9, "Third"},
		{"main.d.ts", declarations, 10, ""},
		{"main.d.ts", declarations, 99, ""},
		{consumerModule, consumer, 1, "./out/main.js"},
		{consumerModule, consumer, 3, "second"},
	} {
		if got := consumerDeclaration(tc.base, tc.text, tc.line); got != tc.want {
			t.Errorf("%s line %d: declaration %q, want %q", tc.base, tc.line, got, tc.want)
		}
	}
}

// The stock half of D366 drops an error inside an installed package or a
// declaration file the project supplies, by the file the line names. The
// message may name node_modules too: TypeScript prints a file module's symbol
// as its quoted resolved path.
func TestStockConsumerLineOwned(t *testing.T) {
	inputs := []string{"stubs/pkg.d.ts"}
	for _, tc := range []struct {
		line  string
		owned bool
	}{
		{`out/main.d.ts(3,30): error TS2694: Namespace '"/w/node_modules/effect/dist/Effect"' has no exported member 'Nope'.`, true},
		{`__consumer.mts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.`, true},
		{`node_modules/effect/dist/Effect.d.ts(10,5): error TS2550: Property 'dispose' does not exist on type 'SymbolConstructor'.`, false},
		{`../node_modules/effect/dist/Effect.d.ts(10,5): error TS2550: Property 'dispose' does not exist on type 'SymbolConstructor'.`, false},
		{`/w/node_modules/effect/dist/Effect.d.ts(10,5): error TS2550: Property 'dispose' does not exist on type 'SymbolConstructor'.`, false},
		{`stubs/pkg.d.ts(1,1): error TS2304: Cannot find name 'Absent'.`, false},
		{`stubs/pkg.d.ts.d.ts(1,1): error TS2304: Cannot find name 'Absent'.`, true},
		{`./stubs/pkg.d.ts(1,1): error TS2304: Cannot find name 'Absent'.`, false},
		{`vendor(copy)/node_modules/pkg/index.d.ts(1,1): error TS2304: Cannot find name 'Absent'.`, false},
		{`out/(group)/main.d.ts(1,1): error TS2694: Namespace '"node_modules/pkg"' has no exported member 'X'.`, true},
		{`C:\work\node_modules\pkg\index.d.ts(1,1): error TS2304: Cannot find name 'Absent'.`, false},
		{`error TS2688: Cannot find type definition file for 'node'. The file is in the program because: entry point of type library '/w/node_modules/@types/node'`, true},
	} {
		if got := stockConsumerLineOwned(tc.line, inputs); got != tc.owned {
			t.Errorf("owned %v, want %v: %s", got, tc.owned, tc.line)
		}
	}
}

// A malformed JavaScript output does not establish whether declarations
// type-check. D366 remains independent of the JavaScript oracle.
func TestOutputsConsumerBesideOtherOutputGap(t *testing.T) {
	w := NewWorkspace(t)
	c, err := w.CompileOrdered(t.Context(), Single("export const n = 1\n"), OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	c.Outputs["out/main.js"] = "export const n = ;\n"
	g := &Gaps{Target: "FuzzCompile"}
	(&OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}).Check(c)
	if !g.Any() {
		t.Fatal("invalid JavaScript output was not rejected")
	}
	if _, err := os.Stat(filepath.Join(c.Dir, "__declarations", consumerModule)); err != nil {
		t.Fatalf("a JavaScript output gap suppressed the declaration consumer: %v", err)
	}
}

// A valid imported lint configuration is irrelevant to D366. An own or
// unregistered EK error is still a consumer failure, with a distinct source.
func TestOutputsConsumerDiagnosticKinds(t *testing.T) {
	for _, tc := range []struct {
		source   string
		code     int32
		category diagnostics.Category
		want     bool
		key      string
	}{
		{"", 2322, diagnostics.CategoryError, true, "feature:declaration-consumer-TS2322:Widget"},
		{"", 3823, diagnostics.CategoryError, true, "feature:declaration-consumer-TS3823:Widget"},
		{"EK", 3823, diagnostics.CategoryError, false, "feature:declaration-consumer-EK3823:Widget"},
		{"EK", 4618, diagnostics.CategoryError, true, "feature:declaration-consumer-EK4618:Widget"},
		{"EK", 401, diagnostics.CategoryError, true, "feature:declaration-consumer-EK0401:Widget"},
		{"EK", 401, diagnostics.CategoryWarning, false, "feature:declaration-consumer-EK0401:Widget"},
	} {
		d := ast.NewExternalDiagnostic(nil, core.TextRange{}, tc.source, tc.category, tc.code, "consumer control")
		if got := declarationConsumerError(d); got != tc.want {
			t.Errorf("%s%d %s: retained %v, want %v", tc.source, tc.code, tc.category.Name(), got, tc.want)
		}
		if got := consumerDiagnosticKey(d, "Widget"); got != tc.key {
			t.Errorf("key %s, want %s", got, tc.key)
		}
	}
}
