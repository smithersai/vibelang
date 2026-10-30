package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestRun4CauseCatchFix(t *testing.T) {
	t.Run("fix:unapplied:EK2113:offered", func(t *testing.T) {
		data, err := os.ReadFile(filepath.Join("../../../..", "typescript/vibelang/cases/catch-retired/main.vibe"))
		if err != nil {
			t.Fatal(err)
		}
		p, file, _, _ := editorProgram(t, string(data))
		found := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			found = found || d.Source() == "EK" && d.Code() == 2113
		}
		if !found {
			t.Fatal("first failing program no longer reports EK2113")
		}
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		for _, refusal := range result.Refused {
			if refusal.Code == 2113 {
				t.Fatalf("offered Cause repair was refused: %+v", refusal)
			}
		}
		fixed := result.Files[file.FileName()]
		if fixed == nil {
			t.Fatal("Cause catch was not fixed")
		}
		checked, next, _, _ := editorProgram(t, fixed.Text)
		items := append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...)
		for _, d := range items {
			if d.Source() == "EK" && d.Code() == 2113 || d.Category() == diagnostics.CategoryError {
				t.Fatalf("fixed program: %s\n%s", d.String(), fixed.Text)
			}
		}
	})
}
