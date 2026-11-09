package vibelang

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 006 and Appendix A: a member of a schema body that is not a Field is
// EK1505, and a member of a schema alias's object type with no schema form is
// EK2109. The mapping replaces the member, but its modifiers keep the
// rejections TypeScript gives them on a type literal: TS1070 for a class-only
// modifier, TS1024 for readonly on a method, accessor or signature, and EK0108
// for effect (Functions, static rules).
func TestSchemaAliasMethodModifiers(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string // the error codes, sorted
	}{
		{"alias-async-method", "schema S = { async m(): string }", []string{"EK2109", "TS1070"}},
		{"alias-static-method", "schema S = { static m(): string }", []string{"EK2109", "TS1070"}},
		{"alias-public-method", "schema S = { public m(): string }", []string{"EK2109", "TS1070"}},
		{"alias-readonly-method", "schema S = { readonly m(): string }", []string{"EK2109", "TS1024"}},
		{"alias-effect-method", "schema S = { effect m(): string }", []string{"EK0108", "EK2109"}},
		{"alias-effect-optional-method", "schema S = { effect m?(): string }", []string{"EK0108", "EK2109"}},
		{"alias-readonly-get-parse-error", "schema S = { readonly get m(): string }", []string{"EK2109", "TS1131"}},
		{"alias-method-named-static", "schema S = { static (): string }", []string{"EK2109"}},
		{"alias-readonly-index", "schema S = { readonly [k: string]: string }", []string{"EK2109"}},
		{"alias-method-after-field", "schema S = { a: string; async m(): string }", []string{"EK2109", "TS1070"}},
		{"body-async-method", "schema S { async m(): string }", []string{"EK1505", "TS1070"}},
		{"body-readonly-method", "schema S { readonly m(): string }", []string{"EK1505", "TS1024"}},
		{"body-effect-method", "schema S { effect m(): string }", []string{"EK0108", "EK1505"}},
		{"alias-method-named-async", "schema S = { async(): string }", []string{"EK2109"}},
		{"alias-method-named-readonly", "schema S = { readonly(): string }", []string{"EK2109"}},
		{"alias-method-named-effect", "schema S = { effect(): string }", []string{"EK2109"}},
		{"alias-effect-line-break", "schema S = { effect\nm(): string }", []string{"EK2109", "EK2109"}},
		{"alias-plain-method", "schema S = { m(): string }", []string{"EK2109"}},
		{"type-literal-control", "type T = { async m(): string; readonly g(): string }", []string{"TS1024", "TS1070"}},
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
