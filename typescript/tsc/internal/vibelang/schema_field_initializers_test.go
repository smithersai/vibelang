package vibelang

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestSchemaFieldInitializers(t *testing.T) {
	source := "schema Direct { value: number = 42 }\nschema Optional { value?: number = 42 }\nschema Alias = { readonly value: string = \"ignored\" }\nschema Nested { child: { value: number = 42 } }\nnamespace N { export schema Named { value: number = 42 } }\nschema error Outer { readonly child: { value: number = 42 } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1247 {
			text := file.Text()[d.Pos():d.End()]
			if text != "42" && text != "\"ignored\"" {
				t.Fatalf("wrong initializer span %q", text)
			}
			count++
		}
	}
	if count != 6 {
		t.Fatalf("got%d ignored initializers,want6", count)
	}
}

func TestSchemaFieldInitializerControls(t *testing.T) {
	source := "const value=42\nschema Good { readonly value: number; maybe?: string; default: number }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 1247 {
			t.Fatalf("valid schema rejected: %s", d.String())
		}
	}
}

func TestFixProjectSchemaFieldInitializers(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export schema Direct { readonly value?: number = /* keep */ ignoredName(42) }\n")
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("initializer fix: %+v", result)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || strings.Contains(fixed.Text, "ignoredName") || !strings.Contains(fixed.Text, "/* keep */") || !strings.Contains(fixed.Text, "readonly value?: number") {
		t.Fatalf("lost comment/modifiers or kept ignored expression: %+v", fixed)
	}
	var report bytes.Buffer
	result.Report(&report, func(name tspath.RootedFilePath) string { return name.AsString() })
	if !strings.Contains(report.String(), "TS1247 ×1") {
		t.Fatalf("wrong native report: %s", report.String())
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 {
		t.Fatalf("second fix: %+v", again)
	}
}
