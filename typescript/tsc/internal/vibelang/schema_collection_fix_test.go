package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestSchemaCollectionAliasRoundTrips(t *testing.T) {
	for _, test := range []struct{ name, expression, typ, use string }{
		{"readonly array", "Schema.Array(Schema.Number)", "ReadonlyArray<number>", "declare const input: readonly number[]\nexport const assigned: Values = input\n"},
		{"readonly tuple", "Schema.Tuple([Schema.Number, Schema.String])", "readonly [number, string]", "declare const input: readonly [number, string]\nexport const assigned: Values = input\n"},
		{"readonly record", "Schema.Record(Schema.String, Schema.Number)", "Readonly<Record<string, number>>", "declare const input: Readonly<Record<string, number>>\nexport const assigned: Values = input\n"},
		{"mutable array", "Schema.mutable(Schema.Array(Schema.Number))", "Array<number>", "export const assigned: Values = []\nassigned.push(1)\n"},
		{"mutable tuple", "Schema.mutable(Schema.Tuple([Schema.Number, Schema.String]))", "[number, string]", "declare const assigned: Values\nassigned[0] = 2\n"},
		{"mutable record", "Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))", "Record<string, number>", "export const assigned: Values = {}\nassigned.a = 1\n"},
		{"nested readonly", "Schema.Array(Schema.Tuple([Schema.String, Schema.Number]))", "ReadonlyArray<readonly [string, number]>", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export const Values = " + test.expression + "\nexport type Values = typeof Values.Type\n" + test.use
			got := applyQuickFix(t, source, EK4841.Code)
			want := "export schema Values = " + test.typ + "\n" + test.use
			if got != want {
				t.Fatalf("got:\n%s\nwant:\n%s", got, want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, diagnostic := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s", diagnostic.String())
				}
			}
		})
	}
}
