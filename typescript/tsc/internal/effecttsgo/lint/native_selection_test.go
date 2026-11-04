package lint

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCommandUsesCompilerConfigWithOxlintFiles(t *testing.T) {
	for _, fixture := range []struct{ name, file, text string }{
		{"json-empty", ".oxlintrc.json", "{}"},
		{"json-invalid", ".oxlintrc.json", "not valid JSON"},
		{"typescript", "oxlint.config.ts", "export default { rules: {} }"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, text := range map[string]string{
				"tsconfig.json": `{"compilerOptions":{"strict":true,"declaration":true,"incremental":true,"tsBuildInfoFile":"build.tsbuildinfo"},"files":["main.ts"]}`,
				"main.ts":       `export const value: string = 1;`,
				fixture.file:    fixture.text,
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
			status := Command(context.Background(), sys, []string{"-p", dir, "--pretty", "false", "--strict"})
			output := sys.out.String() + sys.err.String()
			if status == 0 || !strings.Contains(output, "error TS2322:") {
				t.Fatalf("lint must use the selected compiler project despite unrelated %s: status=%d\n%s", fixture.file, status, output)
			}
			for _, name := range []string{"main.js", "main.d.ts", "build.tsbuildinfo"} {
				if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
					t.Errorf("lint emitted %s (stat=%v)", name, err)
				}
			}
		})
	}
}
