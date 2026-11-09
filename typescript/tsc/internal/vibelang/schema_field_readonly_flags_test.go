package vibelang

import (
	"strings"
	"testing"
)

func TestSchemaReadonlyFieldReferenceFlags(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nconst Alias=Mutable\nconst Uncertain=Mutable as Schema.Top\nschema Direct { readonly value: Mutable; readonly maybe?: Mutable }\nschema Aliased { readonly value: Alias }\nschema Wide { readonly value: Uncertain }\nschema Nested { readonly child: { readonly value: Mutable } }\nnamespace N { export schema Named { readonly value: Mutable } }\nschema error Outer { readonly child: { readonly value: Mutable } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), "A readonly schema field") {
			count++
		}
	}
	if count != 7 {
		t.Fatalf("got %d readonly reference errors, want 7", count)
	}
}

func TestSchemaReadonlyFieldReferenceControls(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nconst Readonly=Schema.Number\nconst MutableArray=Schema.mutable(Schema.Array(Schema.Number))\nschema Writable { value: Mutable; maybe?: Mutable }\nschema Good { readonly value: Readonly; readonly maybe?: Readonly; readonly array: MutableArray; readonly nested: { value: Mutable } }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
			t.Fatalf("valid shallow readonly/control rejected: %s", d.String())
		}
	}
}

func TestSchemaReadonlyFieldReferenceInverseSafety(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nexport const Codec=Schema.Struct({value:Mutable})\nexport type Codec=typeof Codec.Type\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
			t.Fatalf("unsafe inverse: %s", d.String())
		}
	}
}
