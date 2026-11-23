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
		{"decoder", "effect ", "const dec=Schema.decodeUnknownSync(Schema.String); return ⟦dec(s)⟧", 403},
		{"curried-unsafe", "effect ", "const divide=Effect.Number.divideUnsafe(2); return ⟦divide(4)⟧", 403},
		{"direct-unsafe", "effect ", "return ⟦Effect.Number.divideUnsafe(4, 2)⟧", 403},
		{"unsafe-date", "", "return ⟦DateTime.makeUnsafe(s)⟧", 401},
		{"safe-effect", "effect ", "return Option.some(s)", 0},
		{"stringify", "effect ", "return ⟦JSON.stringify(s)⟧", 403},
		{"repeat", "effect ", "return ⟦s.repeat(2)⟧", 403},
		{"fixed", "", "return ⟦(1.5).toFixed(2)⟧", 401},
		{"encode-uri", "", "return ⟦encodeURI(s)⟧", 401},
		{"encode-component", "", "return ⟦encodeURIComponent(s)⟧", 401},
		{"date-iso-never", "", "return new Date(s).toISOString()", 0},
		{"intl-ctor-never", "", "return new Intl.DateTimeFormat(s)", 0},
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
