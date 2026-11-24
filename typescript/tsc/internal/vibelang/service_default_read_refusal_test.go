package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceDefaultWarningWithTypeReads(t *testing.T) {
	for _, read := range []string{
		"type K = \"default\"; export type Value = (typeof Flags)[K];",
		"export type Value = (typeof Flags)[(\"default\")];",
		"export type Value = (typeof Flags)[\"default\" | \"key\"];",
		"export type Value = typeof Flags.default.read<string>;",
	} {
		source := "service Flags { static readonly key = \"app/Flags\"; static readonly default: Flags.Shape = { enabled: true, read: <T>(x: T) => x }; enabled: boolean; read: <T>(x: T) => T }\n" + read
		p, file, _, _ := editorProgram(t, source)
		warned := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid fixture: %s", d.String())
			}
			warned = warned || d.Code() == EK4855.Code
		}
		if !warned {
			t.Fatal("expected the legacy service default diagnostic")
		}
	}
}
