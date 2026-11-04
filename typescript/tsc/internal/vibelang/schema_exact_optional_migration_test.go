package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The t3code-style migration preserves omission and explicit undefined
// while the explicit legacy upgrade retains readonly native declarations.
func TestSchemaExactOptionalMigration(t *testing.T) {
	source := `export schema S { value?: string; readonly loose?: string | undefined; nested?: { inside?: number }; list: [string?, (number | undefined)?] }
export schema error E { value?: number; get label() { return "kept" } }
export schema T = readonly [label?: string, count?: number | undefined]
export data D { Some { value?: string } }
export interface Native { value?: string }
`
	for _, exact := range []bool{false, true} {
		for _, migrate := range []bool{false, true} {
			t.Run(strings.Join([]string{map[bool]string{false: "default", true: "exact"}[exact], map[bool]string{false: "fix", true: "migration"}[migrate]}, "/"), func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				program.Options().ExactOptionalPropertyTypes = core.BoolToTristate(exact)
				fs := bundled.WrapFS(osvfs.FS())
				options := FixOptions{MigrationOnly: migrate}
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), options)
				if len(result.Refused) != 0 {
					t.Fatalf("refused: %+v", result.Refused)
				}
				fixed := result.Files[file.FileName()]
				if !exact || !migrate {
					if fixed != nil && strings.Contains(fixed.Text, "value?: string | undefined") {
						t.Fatalf("unexpected migration: %s", fixed.Text)
					}
					return
				}
				if fixed == nil {
					t.Fatal("missing optional-schema compatibility migration")
				}
				for _, want := range []string{
					"value?: string | undefined", "loose?: string | undefined",
					"readonly nested?: { readonly inside?: number | undefined } | undefined",
					"[(string | undefined)?, (number | undefined)?]",
					"value?: number | undefined", "label?: (string | undefined)",
					"export data D { Some { value?: string } }",
					"export interface Native { readonly value?: string }",
				} {
					if !strings.Contains(fixed.Text, want) {
						t.Errorf("missing %q:\n%s", want, fixed.Text)
					}
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), program.CommandLine(), options)
				if len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("not idempotent: %+v", again)
				}
			})
		}
	}
}
