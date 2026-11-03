package vibelang

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// VIP-4 detail 282 and VIP-34: keep the public API and the exact thrown value.
func TestTrustedEmptyMigration(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/trusted-empty-migration"), root)
	before := migrationRuleDeclarations(t, dir, nil)
	if before["lib.d.ts"] == "" {
		t.Fatal("no lib.d.ts API")
	}
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
	}
	changed := false
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "lib.vibe" {
			changed = true
			if strings.Contains(fixed.Text, "trusted(Dialect.integer, [])") || !strings.Contains(fixed.Text, "Effect.orDie(Effect.try({ try: () => doubled(n), catch: (error) => error }))") {
				t.Fatalf("missing preserving bridge:\n%s", fixed.Text)
			}
		}
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if !changed {
		t.Fatal("--fix did not retire trusted(f, [])")
	}
	if after := migrationRuleDeclarations(t, dir, nil); !reflect.DeepEqual(before, after) {
		t.Fatalf("API changed:\nbefore %v\nafter %v", before, after)
	}
	if again := fixCase(t, dir); len(again.Files) != 0 {
		t.Fatalf("not a fixed point: %v", again.Order)
	}
}

func TestTrustedEmptyMigrationRefusesEscapes(t *testing.T) {
	for name, source := range map[string]string{
		"export":   "export const safe = trusted(Math.max, [])",
		"escape":   "const safe = trusted(Math.max, []); export const escaped = [safe]",
		"plain":    "const safe = trusted(Math.max, []); export function f() { return safe(1, 2) }",
		"property": "const safe = trusted(Math.max, []); export const errors = safe.name",
		"listed":   "const safe = trusted(Math.max, [Error]); export effect function f() { return safe(1, 2) }",
		"comments": "const safe = trusted(Math.max, /* approval */ []); export effect function f() { return safe(1, 2) }",
	} {
		t.Run(name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, "import { trusted } from \"vibelang-runtime\"\n"+source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			for _, fixed := range fixCase(t, dir).Files {
				if !strings.Contains(fixed.Text, "trusted(") {
					t.Fatalf("unsafe migration: %s", fixed.Text)
				}
			}
		})
	}
}
