package vibelang

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Appendix A: DataDeclaration = DataStart TypeParameters? "{" (Variant
// (Separator Variant)* Separator?)? "}". TypeParameters has at least one
// TypeParameter, as a class reports with TS1098.
func TestDataDeclarationGrammar(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string
	}{
		{"empty-type-parameters", "data D<> { Value { value: number } }", []string{"TS1098"}},
		{"empty-type-parameters-space", "data D< > { Value { value: number } }", []string{"TS1098"}},
		{"empty-type-parameters-export", "export data D<> { Value { value: number } }", []string{"TS1098"}},
		{"empty-type-parameters-empty-body", "data D<> { }", []string{"TS1098"}},
		{"type-parameter-control", "data D<A> { Value { value: A } }", nil},
		{"no-type-parameters-control", "data D { Value { value: number } }", nil},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, row.source)
			var got []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
			sort.Strings(got)
			if strings.Join(got, " ") != strings.Join(row.want, " ") {
				t.Fatalf("errors %v want %v: %s", got, row.want, row.source)
			}
		})
	}
}
