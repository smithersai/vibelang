package vibelang

import (
	"os"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// EK2301's codemod keeps the meaning a pipe followed by a conditional had
// through VibeLang 0.0.11, x |> (f(%) ? a : b), and a second run changes
// nothing (007-tooling.md, Codemods).
func TestPipeConditionalFix(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export function f(x: number) { return x |> % > 0 ? % : 0 }", "export function f(x: number) { return x |> (% > 0 ? % : 0) }"},
		{"function g(n: number) { return n + 1 }\nexport function f(x: number) { return x |> g(%) |> % > 1 ? \"big\" : \"small\" }", "function g(n: number) { return n + 1 }\nexport function f(x: number) { return x |> g(%) |> (% > 1 ? \"big\" : \"small\") }"},
		{"export function f(x: number, ok: boolean) { return ok ? x |> % ? 1 : 2 : 3 }", "export function f(x: number, ok: boolean) { return ok ? x |> (% ? 1 : 2) : 3 }"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			fixed := result.Files[file.FileName()]
			if fixed == nil || fixed.Text != tc.want || fixed.Counts[2301] != 1 {
				t.Fatalf("fix: %+v\n%v", result, fixed)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source reports %v\n%s", d, fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0o600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix changed the project: %+v", again)
			}
		})
	}
}
