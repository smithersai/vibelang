package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const catchBoundaryIdentityQuote = "| `catch` outside effect code | `EK0504` |"

func TestCatchBoundaryIdentityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), catchBoundaryIdentityQuote) {
		t.Fatal("missing catch boundary diagnostic ownership rule")
	}
}

func FuzzCatchBoundaryIdentity(f *testing.F) {
	startShortBudget(f)
	homes := []string{"module", "plain", "async", "field", "static", "getter", "parameter", "callback", "nested-plain", "method", "effect-parameter"}
	for _, home := range homes {
		for _, variant := range []uint8{0, 3, 4, 7, 8, 11} {
			f.Add(home, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, home string, variant uint8) {
		TestCatchBoundaryIdentityQuoted(t)
		handler := "() => 0"
		if variant&1 != 0 {
			handler = "effect () => 0"
		}
		expression := "work() catch " + handler
		if variant&4 != 0 {
			expression = "true ? (" + expression + ") : 0"
		}
		if variant&8 != 0 {
			expression = "((" + expression + "))"
		}
		templates := map[string]string{
			"nested-plain":     "export effect function outer() { return () => %s }",
			"method":           "export class Store { read() { return %s } }",
			"effect-parameter": "export effect function probe(value = %s) { return value }",
			"module":           "export const value = %s",
			"plain":            "export function probe() { return %s }",
			"async":            "export async function probe() { return %s }",
			"field":            "export class Store { value = %s }",
			"static":           "export class Store { static value = %s }",
			"getter":           "export class Store { get value() { return %s } }",
			"parameter":        "export function probe(value = %s) { return value }",
			"callback":         "declare function schedule(f: () => number): number; export const value = schedule(() => %s)",
		}
		if variant&12 != 0 {
			templates["callback"] = "declare function schedule<A>(f: () => A): A; export const value = schedule(() => %s)"
		}
		template, ok := templates[home]
		if !ok {
			template = templates[homes[len(home)%len(homes)]]
		}
		source := "declare function work(): number!!;\n" + fmt.Sprintf(template, expression) + "\n"
		if variant&2 != 0 {
			source = "const 名前 = 1;\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		keyword := strings.Index(source, " catch ") + 1
		native := toolsCompile(t, w, "FuzzCatchBoundaryIdentity", map[string]string{"main.vibe": source})
		defer native.Remove()
		found := 0
		for _, d := range native.Diagnostics {
			if IsEK(d) && d.Code() == 1001 {
				t.Fatal("native checker emitted retired implicit execution diagnostic")
			}
			if IsEK(d) && d.Code() == 504 {
				if d.Category().Name() != "error" || d.Pos() != keyword || d.End() != keyword+len("catch") {
					t.Fatalf("native catch boundary span/category: %v", d)
				}
				found++
				continue
			}
			if d.Category().Name() == "error" {
				t.Fatalf("unexpected native diagnostic: %v", d)
			}
		}
		if found != 1 {
			t.Fatalf("native catch boundary missing: %v", SortedKeys(Keys(native.Dir, native.Diagnostics)))
		}
		projection := vibelangmapper.Project(source, vibelangmapper.FileContext{FileName: filepath.Join(native.Dir, "main.vibe"), ModuleKey: "catch-boundary/main"})
		found = 0
		for _, d := range projection.Diagnostics {
			if d.Code == 1001 {
				t.Fatalf("mapper retains retired implicit execution identity at [%d,%d)", d.Start, d.Start+d.Length)
			}
			if d.Code == 504 {
				if d.Start != keyword || d.Length != len("catch") {
					t.Fatalf("mapper catch boundary span: %+v", d)
				}
				found++
			}
		}
		if found != 1 {
			t.Fatalf("mapper catch boundary missing: %+v", projection.Diagnostics)
		}
		positive := "declare function work(): number!!;\nexport effect function probe(): number!! { return " + expression + " }\n"
		valid := toolsCompile(t, w, "FuzzCatchBoundaryIdentity", map[string]string{"main.vibe": positive})
		defer valid.Remove()
		if HasError(valid.Diagnostics) {
			t.Fatalf("valid effect catch rejected: %v", SortedKeys(Keys(valid.Dir, valid.Diagnostics)))
		}
		projected := vibelangmapper.Project(positive, vibelangmapper.FileContext{FileName: filepath.Join(valid.Dir, "main.vibe"), ModuleKey: "catch-boundary/main"})
		if len(projected.Diagnostics) != 0 {
			t.Fatalf("valid mapped effect catch rejected: %+v", projected.Diagnostics)
		}
	})
}
