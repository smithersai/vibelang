package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestErrorReadonlyMigrationModes(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, mode := range []struct {
			name    string
			options FixOptions
			changed bool
		}{
			{"ordinary", FixOptions{}, false},
			{"migration-only", FixOptions{MigrationOnly: true}, true},
		} {
			t.Run(form+"/"+mode.name, func(t *testing.T) {
				source := "export " + form + " Problem { value: { count: number }; method(input: { count: number }): { count: number } { return input } }\n"
				p, file, _, _ := editorProgram(t, source)
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
				if result.Err != nil || len(result.Remaining) != 0 || len(result.Refused) != 0 || (len(result.Files) != 0) != mode.changed {
					t.Fatalf("migration changed=%v, want %v: %+v", len(result.Files) != 0, mode.changed, result)
				}
				fixed := source
				if mode.changed {
					next := result.Files[file.FileName()]
					if next == nil {
						t.Fatal("missing fixed source")
					}
					fixed = next.Text
					if strings.Count(fixed, "readonly count") != 3 {
						t.Fatalf("nested contracts were not preserved:\n%s", fixed)
					}
					if err := os.WriteFile(file.FileName().AsString(), []byte(fixed), 0600); err != nil {
						t.Fatal(err)
					}
					again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
					if len(again.Files) != 0 || len(again.Refused) != 0 {
						t.Fatalf("second migration changed source: %+v", again)
					}
				}
				// The old contract rejects these nested writes; ordinary --fix preserves
				// their new TypeScript mutability instead of making valid code readonly.
				probe := fixed + "export function write(p: Problem): void { p.value.count = 2; p.method({ count: 1 }).count = 2 }\n"
				program, next, _, _ := editorProgram(t, probe)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), next), program.GetSemanticDiagnostics(t.Context(), next)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() != 2540 {
						t.Fatalf("unrelated error: %s", d.String())
					}
					count++
				}
				want := 0
				if mode.changed {
					want = 2
				}
				if count != want {
					t.Fatalf("got %d readonly errors, want %d", count, want)
				}
			})
		}
	}
}
