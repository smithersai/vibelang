package lint

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestCommandFollowsReferencedLintProjects(t *testing.T) {
	for _, shape := range []struct {
		name, solution, child string
		files                 map[string]string
	}{
		{"named-config", "{\"files\":[],\"references\":[{\"path\":\"./tsconfig.node.json\"}]}", "tsconfig.node.json", nil},
		{"jsonc-layout", "{// solution\n\"files\" :\n[],\n\"references\":[{\"path\":\"./tsconfig.node.json\"}],\n}", "tsconfig.node.json", nil},
		{"directory-reference", "{\"files\":[],\"references\":[{\"path\":\"./runtime\"}]}", "runtime/tsconfig.json", nil},
		{"transitive", "{\"files\":[],\"references\":[{\"path\":\"./intermediate.json\"}]}", "tsconfig.node.json", map[string]string{"intermediate.json": "{\"files\":[],\"references\":[{\"path\":\"./tsconfig.node.json\"}]}"}},
		{"reference-cycle", "{\"files\":[],\"references\":[{\"path\":\"./intermediate.json\"}]}", "tsconfig.node.json", map[string]string{"intermediate.json": "{\"files\":[],\"references\":[{\"path\":\"./tsconfig.json\"},{\"path\":\"./tsconfig.node.json\"}]}"}},
		{"unrelated-root", "{\"files\":[\"root.ts\"],\"references\":[{\"path\":\"./tsconfig.node.json\"}]}", "tsconfig.node.json", map[string]string{"root.ts": "export const root = 1"}},
	} {
		for _, mode := range []string{"automatic", "project-file", "project-directory"} {
			t.Run(shape.name+"/"+mode, func(t *testing.T) {
				dir := t.TempDir()
				write := func(name, text string) {
					t.Helper()
					p := filepath.Join(dir, name)
					if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(p, []byte(text), 0644); err != nil {
						t.Fatal(err)
					}
				}
				write("tsconfig.json", shape.solution)
				source := "src/main.vibe"
				if strings.HasPrefix(shape.child, "runtime/") {
					source = "runtime/src/main.vibe"
				}
				write(source, "export const value = 42\n")
				write(shape.child, "{\"compilerOptions\":{\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"include\":[\"src/**/*.vibe\"]}")
				write(".oxlintrc.json", "{}")
				for name, text := range shape.files {
					write(name, text)
				}
				args := []string{"-c", ".oxlintrc.json"}
				if mode == "project-file" {
					args = append(args, "-p", "tsconfig.json")
				}
				if mode == "project-directory" {
					args = append(args, "-p", ".")
				}
				sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
				status := oxlintAdapterCommand(context.Background(), sys, args)
				if status != 0 || !strings.Contains(sys.out.String(), "in 1 .vibe file(s).") || strings.Contains(sys.err.String(), "not linted") {
					t.Fatalf("referenced native input was not checked: status=%d\n%s%s", status, sys.out.String(), sys.err.String())
				}
				if _, err := os.Stat(filepath.Join(dir, strings.TrimSuffix(source, ".vibe")+".js")); !os.IsNotExist(err) {
					t.Fatalf("lint emitted JavaScript: %v", err)
				}
			})
		}
	}
}

func TestCommandReferencedLintSelectionKeepsCoverageFailures(t *testing.T) {
	dir := t.TempDir()
	for name, text := range map[string]string{
		"tsconfig.json":      "{\"files\":[],\"references\":[{\"path\":\"./tsconfig.node.json\"}]}",
		"tsconfig.node.json": "{\"files\":[\"included.vibe\"]}",
		"included.vibe":      "export const included = 1\n",
		"stray.vibe":         "export const stray = 1\n",
		".oxlintrc.json":     "{}",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	if status := oxlintAdapterCommand(context.Background(), sys, []string{"-c", ".oxlintrc.json", "stray.vibe"}); status != 1 || !strings.Contains(sys.err.String(), "stray.vibe:") || !strings.Contains(sys.err.String(), "not linted") {
		t.Fatalf("an input outside every referenced project must still fail coverage\n%s%s", sys.out.String(), sys.err.String())
	}
}
