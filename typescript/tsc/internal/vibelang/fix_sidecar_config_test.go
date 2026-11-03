package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 007 / retired declarationSidecars is removed from owned configs: docs/design/src/007-tooling.md#9de90af42c444c61
func TestSidecarConfigModernMigration(t *testing.T) {
	for _, test := range []struct {
		name, config, extended, want string
		change                       bool
	}{
		{"tsconfig.json", "{\"vibe\":{\"declarationSidecars\":false,\"effectGlobals\":false},\"files\":[\"main.vibe\"]}", "", "{\"vibe\":{\"effectGlobals\":false},\"files\":[\"main.vibe\"]}", true},
		{"vibe.config.json", "{\"vibe\":{\"effectGlobals\":false,\"declarationSidecars\":true},\"files\":[\"main.vibe\"]}", "", "{\"vibe\":{\"effectGlobals\":false},\"files\":[\"main.vibe\"]}", true},
		{"extended", "{\"extends\":\"./base.json\",\"files\":[\"main.vibe\"]}", "{\"vibe\":{\"declarationSidecars\":true,\"effectGlobals\":false}}", "{\"vibe\":{\"effectGlobals\":false}}", true},
		{"unrelated", "{\"vibe\":{\"unknown\":true},\"other\":{\"declarationSidecars\":true},\"files\":[\"main.vibe\"]}", "", "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			name := "tsconfig.json"
			if test.name == "vibe.config.json" {
				name = test.name
			}
			path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, name)))
			if err := os.WriteFile(path.AsString(), []byte(test.config), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte("export const value = 1\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			target := path
			if test.extended != "" {
				target = tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "base.json")))
				if err := os.WriteFile(target.AsString(), []byte(test.extended), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			fs := osvfs.FS()
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, nil)
			if config != nil {
				errors = slices.Concat(errors, config.GetConfigFileParsingDiagnostics())
			}
			if !slices.ContainsFunc(errors, func(d *ast.Diagnostic) bool {
				return d.Source() == "EK" && d.Code() == core.VibeInvalidConfigCode
			}) {
				t.Fatalf("want EK3007 from the real config loader, got %v", errors)
			}
			overlay, changes := sidecarConfigFixes(fs, errors)
			if !test.change {
				if len(changes) != 0 {
					t.Fatalf("an unrelated unknown key must not remove a property outside language settings: %v", changes)
				}
				return
			}
			if len(changes) != 1 || changes[target] != test.want {
				t.Fatalf("migration = %v, want only %s = %s", changes, target, test.want)
			}
			if text, ok := overlay.ReadFile(target); !ok || text != test.want {
				t.Fatalf("overlay = %q, %v", text, ok)
			}
			if text, _ := fs.ReadFile(target); text == test.want {
				t.Fatal("migration wrote the original filesystem before validation")
			}
		})
	}
}
