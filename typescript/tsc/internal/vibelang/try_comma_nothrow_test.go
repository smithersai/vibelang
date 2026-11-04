package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// An unused function in an ordinary comma operand is still plain code.
// Only a genuine retired hatch admits its throwing callback for migration.
func TestTryCommaKeepsPlainThrowBoundary(t *testing.T) {
	for _, row := range []struct {
		name, expression string
		want             []int32
	}{
		{"comma", "try (() => JSON.parse(\"0\"), Effect.succeed(1))", []int32{401, 2695}},
		{"legacy", "try (() => JSON.parse(\"0\"))", []int32{4616}},
		{"wrapped", "try Effect.try(() => JSON.parse(\"0\"))", nil},
	} {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "import { Effect } from \"effect\";\nexport effect function f() { return "+row.expression+" }\n")
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, row.want) {
				t.Fatalf("errors %v; want %v", got, row.want)
			}
		})
	}
}
