package vibelang

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 006: a field type outside the mapping is EK2109, which explains
// TypeScript's type errors about the value the parser wrote for it. The
// Field grammar does not depend on that type, so the grammar errors of the
// declaration's fields stay: TS1070 for a class-only modifier, TS1030 for a
// repeated readonly and TS1247 for an initializer.
func TestSchemaUnresolvedFieldGrammar(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string // the error codes, sorted
	}{
		{"async", "schema S { async id: Missing }", []string{"EK2109", "TS1070"}},
		{"static", "schema S { static id: Missing }", []string{"EK2109", "TS1070"}},
		{"public", "schema S { public id?: Missing }", []string{"EK2109", "TS1070"}},
		{"duplicate-readonly", "schema S { readonly readonly id: Missing }", []string{"EK2109", "TS1030"}},
		{"initializer", "schema S { key: Missing = \"k\" }", []string{"EK2109", "TS1247"}},
		{"alias-async", "schema S = { async id: Missing }", []string{"EK2109", "TS1070"}},
		{"alias-static-line-break", "schema S = { static\nid: Missing }", []string{"EK2109", "TS1070"}},
		{"sibling", "schema S { a: Missing; async id: string }", []string{"EK2109", "TS1070"}},
		{"nested", "schema S { a: { static b: Missing } }", []string{"EK2109", "TS1070"}},
		{"undeclared", "schema S { a: Missing }", []string{"EK2109"}},
		{"type-only", "type Missing = number; schema S { a: Missing }", []string{"EK2109"}},
		{"value", "const Missing = 1; schema S { a: Missing }", []string{"EK2109"}},
		{"namespace", "import { Option } from \"effect\"; schema S { a: Option }", []string{"EK2109"}},
		{"member", "schema S { a: Missing.Nested }", []string{"EK2109"}},
		{"alias-reference", "schema S = Missing", []string{"EK2109"}},
		{"resolved", "schema S { readonly id: string }", nil},
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
				got = append(got, fmt.Sprintf("%s%04d", prefix, d.Code()))
			}
			sort.Strings(got)
			if strings.Join(got, " ") != strings.Join(row.want, " ") {
				t.Fatalf("errors %v, want %v: %s", got, row.want, row.source)
			}
		})
	}
}
