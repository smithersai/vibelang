package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNativeCallbackDirectRejectsLegacyCompletion(t *testing.T) {
	for _, body := range []string{
		"return try callback<number>(resume => resume(7))",
		"return try callback<number, string>(resume => resume.fail(\"failed\"))",
		"return try callback((value: number, resume: Resume<number, never>) => resume(value), 7)",
	} {
		t.Run(body, func(t *testing.T) {
			var control []int32
			for _, call := range []string{strings.ReplaceAll(body, "callback", "Effect.callback"), body} {
				program, file, _, _ := editorProgram(t, "export effect function main() { "+call+" }")
				var codes []int32
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						codes = append(codes, d.Code())
					}
				}
				slices.Sort(codes)
				if control == nil {
					if len(codes) == 0 {
						t.Fatal("legacy completion unexpectedly satisfies the native control")
					}
					control = codes
				} else if !slices.Equal(codes, control) {
					t.Fatalf("direct global errors %v, native control %v", codes, control)
				}
			}
		})
	}
}
