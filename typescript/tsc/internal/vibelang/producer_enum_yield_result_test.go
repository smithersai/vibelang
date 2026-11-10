package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

// Native enum initializers do not receive the producer's undefined next input.
func TestProducerEnumYieldResultMatrix(t *testing.T) {
	forms := []struct{ key, source string }{
		{"declaration", "export $effectfunction* run(){BODY}"},
		{"expression", "export const run=$effectfunction*(){BODY}"},
		{"class-method", "export class Feed{$effect*run(){BODY}}"},
		{"object-method", "export const feed={$effect*run(){BODY}}"},
	}
	expressions := []struct {
		key, source string
		codes       []int32
	}{
		{"value", "(yield 1)", []int32{1163, 7057}},
		{"discarded", "((yield 1),1)", []int32{1163}},
		{"cast", "((yield 1) as number)", []int32{1163}},
		{"conditional", "true?(yield 1):1", []int32{1163, 7057}},
	}
	for _, form := range forms {
		for _, expression := range expressions {
			for _, producer := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/producer=%t", form.key, expression.key, producer), func(t *testing.T) {
					marker := ""
					if producer {
						marker = "effect "
					}
					source := strings.ReplaceAll(strings.ReplaceAll(form.source, "$effect", marker), "BODY", "enum E{A="+expression.source+"}")
					program, file, _, _ := editorProgram(t, source)
					var got []int32
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got = append(got, d.Code())
						}
					}
					slices.Sort(got)
					if !slices.Equal(got, expression.codes) {
						t.Fatalf("want %v got %v\n%s", expression.codes, got, source)
					}
				})
			}
		}
	}
}
