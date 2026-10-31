package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// When a round's fixes pass together, the program the gate checked them in is
// the next round's, so --fix builds and checks it once. Nested fixes take a
// round per level, since each overlaps the one around it: rewrite-deep-types'
// 20 levels checked its project twice per round and outlasted its 30 s limit
// on a busy host (2026-10-30 and 31).
func TestFixProjectChecksAPassingRoundOnce(t *testing.T) {
	const depth = 6
	source := "export type Deep = " + strings.Repeat("Effect.Effect<", depth) + "number" + strings.Repeat(">", depth) + "\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	for name, text := range map[string]string{
		"plain.ts":      "export const plain = 1\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	builds, fs := countingFS(dir, func(int) {})
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if result.Err != nil || len(result.Order) != 1 || len(result.Refused) != 0 {
		t.Fatalf("fixed %v, refused %+v, error %v; want main.vibe fixed", result.Order, result.Refused, result.Err)
	}
	fixed := result.Files[result.Order[0]]
	if fixed.Counts[4833] != depth || strings.Contains(fixed.Text, "Effect.Effect") {
		t.Fatalf("applied %v, wrote %q; want %d EK4833 fixes and no Effect.Effect left", fixed.Counts, fixed.Text, depth)
	}
	t.Logf("%d programs for %d rounds", *builds, depth)
	// The baseline's program, one per round, and the round that finds no fix
	// reuses the last; building each passing round twice is 2*depth or more.
	if *builds > depth+2 {
		t.Fatalf("--fix built %d programs for %d rounds that each passed whole", *builds, depth)
	}
}
