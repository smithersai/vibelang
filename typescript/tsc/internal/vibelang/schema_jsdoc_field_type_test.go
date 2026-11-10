package vibelang

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 006 and Appendix A: a schema Field takes a source Type. A JSDoc type
// is no TypeScript type: TypeScript rejects a leading ? or ! with TS17020, a
// trailing ? with TS17019 and * with TS8020 on a type literal member. The
// mapping replaces the field's type with a codec and reports EK2109 for a type
// with no schema form; the written type keeps TypeScript's rejection beside it.
func TestSchemaJSDocFieldTypes(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string // the error codes, sorted
	}{
		{"nullable-prefix", "schema S { a: ?string }", []string{"EK2109", "TS17020"}},
		{"nullable-prefix-unresolved", "schema S { a: ?Missing }", []string{"EK2109", "TS17020"}},
		{"nullable-postfix", "schema S { a: string? }", []string{"EK2109", "TS17019"}},
		{"non-nullable", "schema S { a: !string }", []string{"EK2109", "TS17020"}},
		{"all", "schema S { a: * }", []string{"EK2109", "TS8020"}},
		{"double-prefix", "schema S { a: ??string }", []string{"EK2109", "TS17020", "TS17020"}},
		{"alias", "schema S = { a: ?string }", []string{"EK2109", "TS17020"}},
		{"nested", "schema S { a: { b: ?string } }", []string{"EK2109", "TS17020"}},
		{"array-argument", "schema S { a: Array<?string> }", []string{"EK2109", "TS17020"}},
		{"optional-field-control", "schema S { a?: string }", nil},
		{"union-control", "schema S { a: string | null | undefined }", nil},
		{"type-literal-control", "type T = { a: ?string; b: string?; c: !string; d: * }", []string{"TS17019", "TS17020", "TS17020", "TS8020"}},
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
