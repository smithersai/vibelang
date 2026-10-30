package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"testing"
)

func TestErrorImplementsQuickFix(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		t.Run(kind, func(t *testing.T) {
			source := "interface Shape {}\n" + kind + " Bad implements Shape { id: string }\n"
			want := "interface Shape {}\n" + kind + " Bad  { id: string }\n"
			program, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
			fixed, ok := result.Files[file.FileName()]
			if !ok {
				t.Fatalf("--fix changed nothing: %+v", result)
			}
			got := fixed.Text
			if got != want {
				t.Fatalf("got:\n%s\nwant:\n%s", got, want)
			}
			program, file, _, _ = editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s", d.String())
				}
			}
		})
	}
}
