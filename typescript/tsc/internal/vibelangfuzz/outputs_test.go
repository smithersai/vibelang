package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
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
