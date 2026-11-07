package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCatchAsyncHandlerRecovery(t *testing.T) {
	for _, test := range []struct {
		name, handler string
		native        []int32
	}{
		{"concise", "async () => 7", nil},
		{"block", "async () => { return 7 }", nil},
		{"parameter", "async (e) => e.length", nil},
		{"grouped", "(async () => 7)", nil},
		{"function", "async function () { return 7 }", nil},
		{"annotation", "async (): Promise<number> => 7", nil},
		{"written-return-error", "async (): Promise<string> => 7", []int32{2322}},
		{"body-error", "async () => { const x: string = 7; return x }", []int32{2322}},
		{"nested-return-error", "async () => { const f = (): { x: number, y: number } => ({}); return f }", []int32{2739}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export effect function recover() { return Effect.fail(\"bad\") catch " + test.handler + " }"
			p, file, _, _ := editorProgram(t, source)
			got := []int32{}
			syntax := false
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == 509 {
					syntax = true
					continue
				}
				got = append(got, d.Code())
			}
			slices.Sort(got)
			if !syntax || !slices.Equal(got, test.native) {
				t.Fatalf("want EK0509 and native errors %v, got %v (EK0509=%v): %s", test.native, got, syntax, source)
			}
		})
	}
}
