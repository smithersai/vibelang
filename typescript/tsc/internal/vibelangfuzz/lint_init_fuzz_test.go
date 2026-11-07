package vibelangfuzz

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestLintInitQuoted(t *testing.T) { lintNoEmitQuoted(t) }

// Initialization is a compiler option, but lint remains analysis-only.
func FuzzLintInit(f *testing.F) {
	startShortBudget(f)
	keys := []string{"new", "existing", "strict", "out-dir", "help", "invalid-option"}
	for _, key := range keys {
		f.Add(key, byte(0))
		f.Add(key, byte(31))
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		lintNoEmitQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[len(key)%len(keys)]
		}
		dir := t.TempDir()
		source := "// retained ü😀\nexport const n = 1\n"
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
		if key == "existing" {
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte("// preserve\n{}\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		before := lintBuildCleanSnapshot(t, dir)
		flag := "--init"
		if mode&2 != 0 {
			flag = "--INIT"
		}
		args := []string{flag}
		switch key {
		case "strict":
			args = append(args, "--strict")
		case "out-dir":
			args = append(args, "--outDir", "output ü")
		case "help":
			args = append(args, "--help")
		case "invalid-option":
			args = append(args, "--unknown-init-option")
		}
		if mode&4 != 0 {
			args = append(args, "--noEmit", "false")
		}
		sys := &sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
		status := lint.Command(t.Context(), sys, args)
		after := lintBuildCleanSnapshot(t, dir)
		if !reflect.DeepEqual(before, after) {
			Gap(t, "FuzzLintInit", key, "chapter 007 %q: lint initialization changed files; mode=%d before=%v after=%v\n%s", lintNoEmitQuote, mode, before, after, sys.output.String())
		}
		if key == "invalid-option" {
			if status == 0 || !strings.Contains(sys.output.String(), "TS5023") {
				t.Fatalf("native option error lost: status=%d %s", status, sys.output.String())
			}
		} else if key == "existing" {
			if status != 0 || !strings.Contains(sys.output.String(), "TS5054") {
				t.Fatalf("native existing-config result lost: status=%d %s", status, sys.output.String())
			}
		} else if status != 0 {
			t.Fatalf("valid init options: status=%d %s", status, sys.output.String())
		}
		ExpectPending(t, "FuzzLintInit", key)
	})
}
