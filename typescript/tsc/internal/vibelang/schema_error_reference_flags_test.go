package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestSchemaErrorReferenceFlags(t *testing.T) {
	for _, tt := range []struct{ name, decl, field, want string }{
		{"mutable", "const Codec = Schema.mutableKey(Schema.Number)", "value: Codec", "A readonly schema field"},
		{"readonly-written", "const Codec = Schema.mutableKey(Schema.Number)", "readonly value: Codec", "A readonly schema field"},
		{"optional-mutable", "const Codec = Schema.mutableKey(Schema.Number)", "value?: Codec", "A readonly schema field"},
		{"aliased-mutable", "const Mutable = Schema.mutableKey(Schema.Number); const Codec = Mutable", "value: Codec", "A readonly schema field"},
		{"uncertain-readonly", "const Codec = Schema.Number as Schema.Top", "value?: Codec", "A readonly schema field"},
		{"optional", "const Codec = Schema.optionalKey(Schema.Number)", "value: Codec", "A required schema field"},
		{"aliased-optional", "const Optional = Schema.optionalKey(Schema.Number); const Codec = Optional", "value: Codec", "A required schema field"},
		{"uncertain-required", "const Codec = Schema.Number as Schema.Top", "value: Codec", "A required schema field"},
		{"quoted-key", "const Codec = Schema.mutableKey(Schema.Number)", "\"value-key\": Codec", "A readonly schema field"},
		{"numeric-key", "const Codec = Schema.optionalKey(Schema.Number)", "7: Codec", "A required schema field"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := tt.decl + "\nexport schema error Bad { " + tt.field + " }\n"
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), tt.want) {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("got %d %q diagnostics, want 1", count, tt.want)
			}
		})
	}
}

func TestSchemaErrorReferenceFlagControls(t *testing.T) {
	source := `const Optional = Schema.optionalKey(Schema.Number)
const MutableArray = Schema.mutable(Schema.Array(Schema.Number))
export schema error Good { required: number; optional?: Optional; readonly array: MutableArray }
export const Explicit = Schema.Struct({ value: Schema.mutableKey(Schema.Number) })
`
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("control rejected: %s", d.String())
		}
	}
}

func TestSchemaErrorReferenceFlagsLegacyFamilyScope(t *testing.T) {
	source := "const Codec = Schema.mutableKey(Schema.Number)\nabstract schema error Parent { id: string; legacy?: Codec }\nschema error Child extends Parent { value: Codec }\nschema error Widened { _tag: string; legacy?: Codec }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK2109.Code {
			t.Errorf("legacy family needs its own preserving repair: %s", d.String())
		}
	}
}
