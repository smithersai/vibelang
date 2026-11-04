package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-34: extends traversal stays within repository ownership, never dependencies.
func TestSeverityConfigMigrationOwnership(t *testing.T) {
	for _, mode := range []string{"external", "node_modules", "symlink-external", "symlink-dependency", "owned", "owned-parent", "no-vcs", "prefix-sibling"} {
		t.Run(mode, func(t *testing.T) {
			top := t.TempDir()
			repo := filepath.Join(top, "repo")
			selected := repo
			if mode == "owned-parent" {
				selected = filepath.Join(repo, "packages", "app")
			}
			if err := os.MkdirAll(selected, 0755); err != nil {
				t.Fatal(err)
			}
			if mode != "no-vcs" {
				if err := os.Mkdir(filepath.Join(repo, ".jj"), 0755); err != nil {
					t.Fatal(err)
				}
			}
			base := filepath.Join(top, "external", "base.json")
			switch mode {
			case "node_modules", "symlink-dependency":
				base = filepath.Join(repo, "node_modules", "config", "base.json")
			case "owned", "owned-parent", "no-vcs":
				base = filepath.Join(repo, "config", "base.json")
			case "prefix-sibling":
				base = filepath.Join(top, "repo-other", "base.json")
			}
			if err := os.MkdirAll(filepath.Dir(base), 0755); err != nil {
				t.Fatal(err)
			}
			original := "{\n  // retain this comment\n  \"vibelang\": {\"diagnostics\": {\"EK4609\": \"off\"}}\n}\n"
			if err := os.WriteFile(base, []byte(original), 0640); err != nil {
				t.Fatal(err)
			}
			target := base
			if strings.HasPrefix(mode, "symlink-") {
				target = filepath.Join(repo, "base-link.json")
				if err := os.Symlink(base, target); err != nil {
					t.Fatal(err)
				}
			}
			relative, err := filepath.Rel(selected, target)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(relative, ".") {
				relative = "./" + relative
			}
			config := filepath.Join(selected, "tsconfig.json")
			text := "{\"extends\":\"" + filepath.ToSlash(relative) + "\",\"files\":[\"main.vibe\"]}"
			if err := os.WriteFile(config, []byte(text), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(selected, "main.vibe"), []byte("export const n = 1\n"), 0644); err != nil {
				t.Fatal(err)
			}
			sys := &fixSys{fs: osvfs.FS(), cwd: selected}
			if err := migrateSeverityConfigs(sys, tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config))); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(base)
			if err != nil {
				t.Fatal(err)
			}
			owned := mode == "owned" || mode == "owned-parent" || mode == "no-vcs"
			if owned {
				if string(after) == original || !strings.Contains(string(after), "\"severities\"") || !strings.Contains(string(after), "// retain this comment") {
					t.Fatalf("owned base was not migrated preserving comments: %s", after)
				}
				info, err := os.Stat(base)
				if err != nil {
					t.Fatal(err)
				}
				if info.Mode().Perm() != 0640 {
					t.Fatalf("mode changed: %s", info.Mode())
				}
			} else {
				if string(after) != original {
					t.Fatalf("unowned config was edited: %s", after)
				}
				if !strings.Contains(sys.stdout.String(), "not fixed") || !strings.Contains(sys.stdout.String(), "outside repository ownership") {
					t.Fatalf("missing refusal receipt: %s", sys.stdout.String())
				}
			}
			sys.stdout.Reset()
			if err := migrateSeverityConfigs(sys, tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config))); err != nil {
				t.Fatal(err)
			}
			again, err := os.ReadFile(base)
			if err != nil {
				t.Fatal(err)
			}
			if string(again) != string(after) {
				t.Fatal("migration is not idempotent")
			}
		})
	}
}
