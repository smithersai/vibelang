package vibelang

import (
	"strings"
	"testing"
)

func TestRetiredServiceClassIsError(t *testing.T) {
	for _, prefix := range []string{"", "export "} {
		for _, separator := range []string{" ", " /* identity */ ", "\t/*one*/ /*two*/\t"} {
			source := prefix + "service" + separator + "class Users { static readonly key = \"test/Users\"; name: string }\n"
			found := false
			for _, d := range errorsOf(t, source) {
				if d.Code() == 909 {
					found = true
					if !strings.Contains(d.String(), "vibelang --fix") {
						t.Fatalf("no migration advice: %s", d.String())
					}
				} else {
					t.Fatalf("unexpected error: %s", d.String())
				}
			}
			if !found {
				t.Fatalf("retired service class did not report error EK0909: %s", source)
			}
		}
	}
}

func TestControlClassRemainsRejected(t *testing.T) {
	found := false
	for _, d := range trailingBlockErrorsOf(t, "control class Approval { approve(): boolean!! }") {
		if d.Code() == 3501 {
			found = true
		}
		if d.Code() == 909 {
			t.Fatalf("service retirement changed control: %s", d.String())
		}
	}
	if !found {
		t.Fatal("control class did not report EK3501")
	}
}

// The ordinary compiler stops at the parser's EK3501. An editor that asks
// for semantic diagnostics still receives the existing class-token warning.
func TestAppendixEditorHostExamplesRetiredControlClassWarning(t *testing.T) {
	program, file, _, _ := editorProgram(t, "control class Approval { approve(): boolean!! }")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2120.Code {
			if d.Category() != warningCategory || !strings.Contains(d.String(), "control class") {
				t.Fatalf("control class warning changed: %s", d.String())
			}
			return
		}
	}
	t.Fatal("missing editor semantic warning EK2120")
}
