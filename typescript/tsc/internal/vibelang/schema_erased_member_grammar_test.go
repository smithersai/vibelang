package vibelang

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 006 and Appendix A: a type with no schema form is EK2109, and a
// member of a schema body that is not a Field is EK1505. The written type is
// a TypeScript type too, so its members keep TypeScript's grammar errors
// beside those codes: TS1030 for a repeated readonly and TS1070 for a
// class-only modifier under a type operator or an Effect type, and TS1247 for
// an initializer on an untyped or optional member.
func TestSchemaErasedMemberGrammar(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string // the error codes, sorted
	}{
		{"type-operator-duplicate-readonly", "schema S = readonly { readonly readonly id: Missing }", []string{"EK2109", "TS1030"}},
		{"type-operator-static", "schema S = readonly { static id: string }", []string{"EK2109", "TS1070"}},
		{"effect-type-duplicate-readonly", "schema S = join ! { readonly readonly id: Missing }", []string{"EK2109", "TS1030"}},
		{"generic-argument-async", "schema S = Promise<{ async id: string }>", []string{"EK2109", "TS1070"}},
		{"untyped-initializer", "schema S = { id ? = Missing }", []string{"EK2109", "TS1247"}},
		{"untyped-numeric-initializer", "schema S = { 1 ? = Missing }", []string{"EK2109", "TS1247"}},
		{"modifier-optional-initializer", "schema S = { readonly id ? = Missing }", []string{"EK2109", "TS1247"}},
		{"body-untyped-initializer", "schema S { id ? = Missing }", []string{"EK1505", "TS1247"}},
		{"typed-initializer", "schema S { key: Missing = \"k\" }", []string{"EK2109", "TS1247"}},
		{"type-operator-control", "schema S = readonly { readonly id: string }", []string{"EK2109"}},
		{"readonly-array-control", "schema S { a: readonly string[] }", nil},
		{"type-literal-control", "type T = readonly { readonly readonly id: string; b? = 1 }", []string{"TS1030", "TS1247", "TS1354"}},
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
				t.Fatalf("errors %v, want %v: %s", got, row.want, row.source)
			}
		})
	}
}
