package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaEffectFieldModifiers(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         int
	}{
		{"plain", "schema S { effect item: string }", 1},
		{"optional", "schema S { effect item?: number }", 1},
		{"readonly", "schema S { readonly effect item: string }", 1},
		{"comment", "schema S { effect /* keep */ item: string }", 1},
		{"quoted", "schema S { effect \"item\": boolean }", 1},
		{"computed", "schema S { effect [\"item\"]: string }", 1},
		{"nested", "schema S { child: { effect item: string } }", 1},
		{"alias", "schema S = { effect item: string }", 1},
		{"union", "schema S = { effect item: string } | { other: number }", 1},
		{"unsupported-alias", "schema S = Promise<{ effect item: string }>", 1},
		{"unsupported-function", "schema S = () => { effect item: string }", 1},
		{"mixed-modifiers", "schema S { public effect item: string }", 1},
		{"tuple", "schema S = [{ effect item: string }]", 1},
		{"array", "schema S = Array<{ effect item: string }>", 1},
		{"record", "schema S = Record<string, { effect item: string }>", 1},
		{"unresolved-type", "schema S { effect item: Missing }", 1},
		{"two-fields", "schema S { effect a: string; effect b: number }", 2},
		{"data-variant", "data D { A { effect item: string } }", 1},
		{"interface", "interface S { effect item: string }", 1},
		{"literal", "type S = { effect item: string }", 1},
		{"keyword-name", "schema S { effect: string }", 0},
		{"readonly-name", "schema S { readonly effect?: string }", 0},
		{"quoted-name", "schema S { \"effect item\": string }", 0},
		{"computed-name", "schema S { [\"effect item\"]: string }", 0},
		{"ordinary-method-name", "interface S { effect(): number }", 0},
		{"schema-error-name", "schema error E { effect: string }", 0},
		{"line-break-name", "schema S { effect\nitem: string }", 0},
		{"string-control", "const text=\"schema S { effect item: string }\"", 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "// café 😀\n" + row.source
			p, f, _, _ := editorProgram(t, source)
			count := 0
			var codes []string
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%04d", prefix, d.Code()))
				if d.Source() == "EK" && d.Code() == 108 {
					count++
				}
			}
			if count != row.want {
				t.Fatalf("EK0108 count=%d, want %d; diagnostics=%v; source=%s", count, row.want, codes, source)
			}
		})
	}
}
