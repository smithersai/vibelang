package lint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCommandInitPreservesFiles(t *testing.T) {
	for _, args := range [][]string{
		{"--init"}, {"--INIT"}, {"--init", "--strict"}, {"--init", "--help"},
		{"--init", "--outDir", "output"}, {"--init", "--noEmit", "false"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			dir := t.TempDir()
			sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
			status := Command(t.Context(), sys, args)
			if status != 0 {
				t.Fatalf("lint init: status=%d output=%s", status, sys.out.String()+sys.err.String())
			}
			if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
				t.Fatalf("lint init wrote files: entries=%v err=%v", entries, err)
			}
			if !strings.Contains(sys.out.String(), "Would create a new tsconfig.json") || strings.Contains(sys.out.String(), "Created a new tsconfig.json") {
				t.Fatalf("lint init must describe its preview: %s", sys.out.String())
			}
		})
	}
}

func TestCompilerInitStillWritesConfig(t *testing.T) {
	dir := t.TempDir()
	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	result := execute.CommandLine(t.Context(), sys, []string{"--init", "--strict"}, nil)
	if result.Status != 0 {
		t.Fatalf("compiler init: status=%d output=%s", result.Status, sys.out.String()+sys.err.String())
	}
	data, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
	if err != nil || !strings.Contains(string(data), `"strict": true`) {
		t.Fatalf("compiler init did not create its config: %v %s", err, data)
	}
	if !strings.Contains(sys.out.String(), "Created a new tsconfig.json") {
		t.Fatalf("compiler init lost its confirmation: %s", sys.out.String())
	}
}
