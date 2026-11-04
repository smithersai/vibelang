package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"maps"
	"testing"
)

func TestCatchMissingArrowKeepsNativeTypeErrors(t *testing.T) {
	w := NewWorkspace(t)
	for _, head := range []string{"(e)", "effect (e)", "async (e)"} {
		t.Run(head, func(t *testing.T) {
			source := "import { Effect } from \"effect\"; export effect function f() { return Effect.fail(\"bad\") catch " + head + " { const bad: number = \"wrong\"; return 0 } }"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			handler, native := 0, 0
			var codes []string
			for _, d := range r.Diagnostics {
				codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				if IsEK(d) && d.Code() == 509 {
					handler++
				}
				if !IsEK(d) && d.Code() == 2322 {
					native++
				}
				if !IsEK(d) && d.Code() == 2345 {
					t.Errorf("provisional handler argument mismatch was not suppressed: %v", d)
				}
			}
			if handler != 1 || native != 1 {
				t.Fatalf("want one EK0509 and independent TS2322, got %v", codes)
			}
		})
	}
}

// The CLI requests this aggregate instead of calling every diagnostic phase.
// Native syntax still stops checking; only the recovered catch error permits it.
func TestCatchMissingArrowCompilerDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	for _, tc := range []struct {
		name, file, source string
		want               map[string]int
	}{
		{"plain", "main.vibe", `import { Effect } from "effect"; export effect function f() { return Effect.fail("x") catch (e) { const bad: number = "wrong"; return 0 } }`, map[string]int{"EK0509": 1, "TS2322": 1}},
		{"effect", "main.vibe", `import { Effect } from "effect"; export effect function f() { return Effect.fail("x") catch effect (e) { const bad: number = "wrong"; return 0 } }`, map[string]int{"EK0509": 1, "TS2322": 1}},
		{"async", "main.vibe", `import { Effect } from "effect"; export effect function f() { return Effect.fail("x") catch async (e) { const bad: number = "wrong"; return 0 } }`, map[string]int{"EK0509": 1, "TS2322": 1}},
		{"two-handlers", "main.vibe", `import { Effect } from "effect"; export effect function f() { const a = Effect.fail("x") catch (e) { const bad: number = "wrong"; return 0 }; return Effect.fail("y") catch (e) { const bad: number = "wrong"; return 0 } }`, map[string]int{"EK0509": 2, "TS2322": 2}},
		{"independent-native-syntax", "main.vibe", `import { Effect } from "effect"; export effect function f() { return Effect.fail("x") catch (e) { const bad: number = "wrong"; const nested = (n: number) { return n }; return 0 } }`, map[string]int{"EK0509": 1, "TS1005": 1}},
		{"ordinary-typescript-syntax", "main.ts", `export function f(e: string) { const bad: number = "wrong"; const nested = (n: number) { return n }; return 0 }`, map[string]int{"TS1005": 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{tc.file: tc.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			got := map[string]int{}
			for _, d := range compiler.GetDiagnosticsOfAnyProgram(t.Context(), r.Program, nil, false, r.Program.GetBindDiagnostics, r.Program.GetSemanticDiagnostics) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				code := fmt.Sprintf("TS%d", d.Code())
				if IsEK(d) {
					code = fmt.Sprintf("EK%04d", d.Code())
				}
				got[code]++
			}
			if !maps.Equal(got, tc.want) {
				t.Fatalf("compiler diagnostic stages: want %v, got %v", tc.want, got)
			}
		})
	}
}
