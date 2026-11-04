package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3 requires a bridge for an intrinsic signature with non-never throws.
func TestBuiltinThrowsGate(t *testing.T) {
	for _, row := range []struct {
		name, host, body string
		code             int32
	}{
		{"parse", "effect ", "return ⟦JSON.parse(s)⟧", 403},
		{"alias", "effect ", "const parse=JSON.parse; return ⟦parse(s)⟧", 403},
		{"decode-uri", "effect ", "return ⟦decodeURI(s)⟧", 403},
		{"decode-component", "effect ", "return ⟦decodeURIComponent(s)⟧", 403},
		{"bigint", "effect ", "return ⟦BigInt(s)⟧", 403},
		{"regexp", "effect ", "return ⟦RegExp(s)⟧", 403},
		{"locale", "effect ", "return ⟦Intl.getCanonicalLocales(s)⟧", 403},
		{"caught-plain", "", "try { return JSON.parse(s) } catch { return s }", 0},
		{"plain", "", "return ⟦JSON.parse(s)⟧", 401},
		{"bridge", "effect ", "return try Effect.try(() => JSON.parse(s))", 0},
		{"never", "effect ", "return Math.max(1,2)", 0},
		{"parameter", "effect ", "return ((x=⟦JSON.parse(s)⟧)=>x)()", 401},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "export " + row.host + "function probe(s:string){" + row.body + "}"
			start := strings.Index(source, "⟦")
			end := strings.Index(source, "⟧") - len("⟦")
			source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
			program, file, _, _ := requirementIdentityProgram(t, source, nil)
			errors := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors++
				if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code || d.Pos() > end || d.End() < start {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			want := 0
			if row.code != 0 {
				want = 1
			}
			if errors != want {
				t.Errorf("got %d errors, want %d", errors, want)
			}
		})
	}
}
