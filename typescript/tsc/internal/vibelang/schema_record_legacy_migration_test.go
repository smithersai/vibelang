package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestSchemaGenericRecordProjectMigration(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		changed      bool
	}{
		{"old wrong library", "export namespace N { export import Record=globalThis.Array; export schema S=Record<string,number>; export function set(s:S):number {s.x=1;return s.x} }", true},
		{"ordinary record", "export schema S=Record<string,number>", false},
		{"new alias", "namespace N { export import Dictionary=globalThis.Record }; export schema S=N.Dictionary<string,number>", false},
	} {
		for _, mode := range []struct {
			name    string
			options FixOptions
		}{
			{"ordinary", FixOptions{}}, {"compatibility", FixOptions{MigrationOnly: true}}, {"VIP", FixOptions{VIPOnly: true}},
		} {
			t.Run(tc.name+"/"+mode.name, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, tc.source)
				fs := bundled.WrapFS(osvfs.FS())
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), mode.options)
				if result.Err != nil || len(result.Refused) != 0 {
					t.Fatalf("migration failed: %+v", result)
				}
				fixed := result.Files[file.FileName()]
				if !tc.changed {
					if fixed != nil {
						t.Fatalf("new/unchanged form acquired a legacy rewrite: %s", fixed.Text)
					}
					return
				}
				if fixed == nil || !strings.Contains(fixed.Text, "Schema.Record(") {
					t.Fatalf("old record codec not retained: %+v", fixed)
				}
				checked, next, _, _ := editorProgram(t, fixed.Text)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("invalid migration: %s\n%s", d.String(), fixed.Text)
					}
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), mode.options)
				if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("not idempotent: %+v", again)
				}
			})
		}
	}
}
