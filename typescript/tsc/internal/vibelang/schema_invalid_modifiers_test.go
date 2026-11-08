package vibelang

import (
	"strings"
	"testing"
)

func TestSchemaInvalidTypeMemberModifiers(t *testing.T) {
	source := "schema Public { public value: string }\nschema Private { private value: string }\nschema Protected { protected value: string }\nschema Static { static value: string }\nschema Declare { declare value: string }\nschema Abstract { abstract value: string }\nschema Override { override value: string }\nschema Alias = { private value: string }\nschema Nested { child: { public value: string } }\nnamespace N { export schema Named { protected value: string } }\nschema Mixed { public private readonly readonly value: string }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1070 {
			word := file.Text()[d.Pos():d.End()]
			if !strings.Contains("public private protected static declare abstract override", word) {
				t.Fatalf("wrong keyword range %q", word)
			}
			count++
		}
	}
	if count != 11 {
		t.Fatalf("got %d modifier errors, want11", count)
	}
}

func TestSchemaInvalidTypeMemberModifierControls(t *testing.T) {
	source := "schema Good { public: string; readonly private?: number; static: boolean; protected: string; declare: number; abstract: string; override: number }\nconst text=\"public value: string\"\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1070 {
			t.Fatalf("keyword field name rejected: %s", d.String())
		}
	}
}
