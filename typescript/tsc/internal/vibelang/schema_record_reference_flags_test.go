package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaRecordReferenceFlags(t *testing.T) {
	source := `const Optional = Schema.optionalKey(Schema.Number)
const Mutable = Schema.mutableKey(Schema.Number)
const Alias = Optional
declare const Uncertain: typeof Schema.Number | typeof Optional
namespace Codecs { export const MutableNumber = Mutable }
schema Writable = Record<"a", Optional>
schema Readonly = Readonly<Record<"a", Mutable>>
schema Aliased = Record<"a", Alias>
schema Widened = Readonly<Record<"a", Uncertain>>
schema Nested { readonly value: Readonly<Record<string, Codecs.MutableNumber>> }
schema error Problem { value: Record<"a", Optional> }
`
	program, file, _, _ := editorProgram(t, source)
	errors, flags := 0, 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		errors++
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
			flags++
		} else {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
	if errors != 6 || flags != 6 {
		t.Fatalf("got %d errors / %d flag diagnostics; want six EK2109", errors, flags)
	}
}

func TestSchemaRecordReferenceDoesNotSuggestInverseRewrite(t *testing.T) {
	for _, source := range []string{
		`const Optional = Schema.optionalKey(Schema.Number)
export const Values = Schema.Record(Schema.Literal("a"), Schema.mutableKey(Optional))
export type Values = typeof Values.Type
`,
		`const Mutable = Schema.mutableKey(Schema.Number)
export const Values = Schema.Record(Schema.String, Mutable)
export type Values = typeof Values.Type
`,
		`const Optional = Schema.optionalKey(Schema.Number)
export const Outer = Schema.Struct({ values: Schema.Record(Schema.Literal("a"), Optional) })
export type Outer = typeof Outer.Type
`,
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && (d.Code() == EK4841.Code || d.Code() == EK4832.Code) {
				t.Errorf("explicit Record must retain its Effect flags: %s", d.String())
			}
		}
	}
}
