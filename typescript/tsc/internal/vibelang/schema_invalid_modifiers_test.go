package vibelang

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
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

func TestFixProjectSchemaInvalidTypeMemberModifiers(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export schema Direct { public /* keep */ private readonly readonly value: string }\n")
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("fix: %+v", result)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || strings.Contains(fixed.Text, "public") || strings.Contains(fixed.Text, "private") || strings.Count(fixed.Text, "readonly") != 1 || !strings.Contains(fixed.Text, "/* keep */") {
		t.Fatalf("lost comment or incomplete field repair: %+v", fixed)
	}
	var report bytes.Buffer
	result.Report(&report, func(name tspath.RootedFilePath) string { return name.AsString() })
	if !strings.Contains(report.String(), "TS1070 ×1") || strings.Contains(report.String(), "EK1070") {
		t.Fatalf("wrong diagnostic source: %s", report.String())
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 {
		t.Fatalf("second fix: %+v", again)
	}
}

func TestFixProjectLeavesOrdinaryTypeMemberModifiers(t *testing.T) {
	_, file, _, _ := editorProgram(t, "type Original = { public value: string }\n")
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil || len(result.Files) != 0 {
		t.Fatalf("rewrote ordinary unsupported TypeScript: %+v", result)
	}
}
