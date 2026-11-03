package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"strings"
	"testing"
)

// VIP-23/detail246 keeps lexical topic capture across arrow parentheses.
// Both normal --fix and migration mode must repair the complete recovered
// arrow, check the result and leave it unchanged on a second invocation.
func TestPipeArrowBodyFix(t *testing.T) {
	for _, arrow := range []string{"() => %", "async () => %", "effect () => %", "(x: number) => %", "effect (x: number) => { return % + x }", "<T>(x: T) => [%, x]"} {
		for _, migration := range []bool{false, true} {
			t.Run(arrow+map[bool]string{false: "/normal", true: "/migration"}[migration], func(t *testing.T) {
				source := "export const f = 1 |> " + arrow + ";\nexport const after = 2"
				p, file, _, _ := editorProgram(t, source)
				opts := FixOptions{MigrationOnly: migration}
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), opts)
				fixed := result.Files[file.FileName()]
				want := strings.Replace(source, arrow, "("+arrow+")", 1)
				if fixed == nil || fixed.Text != want || fixed.Counts[2301] != 1 || len(result.Refused) != 0 {
					t.Fatalf("fix: %+v; got %+v, want %s", result, fixed, want)
				}
				checked, next, _, _ := editorProgram(t, fixed.Text)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("fixed source: %v\n%s", d, fixed.Text)
					}
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), opts)
				if len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("second fix: %+v", again)
				}
			})
		}
	}
}
