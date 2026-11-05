package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"testing"
)

func TestEffectExtraSlotMigration(t *testing.T) {
	source := "export type X = number!!string!boolean"
	want := "export type X = (number!!string)!boolean"
	p, file, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	fixed := result.Files[file.FileName()]
	if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
		t.Fatalf("grouping migration failed: %+v", result)
	}
	if fixed.Text != want || fixed.Counts[302] != 1 {
		t.Fatalf("got %q (%v), want %q", fixed.Text, fixed.Counts, want)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("grouping migration is not idempotent: %+v", again)
	}
}
