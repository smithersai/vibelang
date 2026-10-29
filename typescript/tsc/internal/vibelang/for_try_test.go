package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestStreamLoopMigration(t *testing.T) {
	for _, head := range []string{"for", "for await"} {
		t.Run(head, func(t *testing.T) {
			source := `import { Stream } from "effect"; export effect function main() { ` + head + ` (const x of Stream.make(1, 2)) { if (x === 1) continue; break } }`
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if !strings.Contains(fixed.Text, "for try (const x of") || fixed.Counts[2007] != 1 {
				t.Fatalf("not migrated: %+v", fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}

		})
	}
}

func TestStreamLoopMigrationLeavesAsyncIterables(t *testing.T) {
	p, _, _, _ := editorProgram(t, `declare const rows: AsyncIterable<number>; export async function consume() { for await (const row of rows) { if (row === 2) break } }`)
	r := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(r.Files) != 0 || len(r.Refused) != 0 {
		t.Fatalf("changed AsyncIterable loop: %+v", r)
	}
}

func TestStreamLoopMigrationRefusesReturn(t *testing.T) {
	p, _, _, _ := editorProgram(t, `import { Stream } from "effect"; export effect function main() { for (const x of Stream.make(1)) { return x }; return 0 }`)
	r := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(r.Files) != 0 || len(r.Refused) != 1 || !strings.Contains(r.Refused[0].Error, "return cannot leave") {
		t.Fatalf("unsafe return migration: %+v", r)
	}
}

func TestStreamLoopMigrationRefusesOutwardJump(t *testing.T) {
	p, _, _, _ := editorProgram(t, `import { Stream } from "effect"; export effect function main() { outer: for (const x of [1]) { for (const row of Stream.make(x)) { if (row === 1) continue outer } } }`)
	r := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(r.Files) != 0 || len(r.Refused) != 1 || !strings.Contains(r.Refused[0].Error, "labeled jump") {
		t.Fatalf("unsafe jump migration: %+v", r)
	}
}
