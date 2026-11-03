package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestGenericMatchPreservingFix(t *testing.T) {
	for _, prefix := range []string{"", "async ", "effect "} {
		t.Run(prefix, func(t *testing.T) {
			source := "export " + prefix + `function f<T extends "A" | "B">(s:T){return match(s){when "A":1;}}`
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			fixed := result.Files[file.FileName()]
			if fixed == nil || fixed.Counts[4701] != 1 || !strings.Contains(fixed.Text, genericMatchNoMatchDefault) {
				t.Fatalf("missing preserving rewrite: %+v / %+v", result, fixed)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source: %s\n%s", d.String(), fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("rewrite not idempotent: %+v", again)
			}
		})
	}
}
