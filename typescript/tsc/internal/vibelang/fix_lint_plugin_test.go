package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-38: write the selected project's own config, retaining inherited plugins,
// settings, comments and permissions; never rewrite its shared base.
func TestLintPluginConfigMigration(t *testing.T) {
	for _, local := range []bool{false, true} {
		t.Run(map[bool]string{false: "inherited", true: "local"}[local], func(t *testing.T) {
			dir := t.TempDir()
			base := `{"compilerOptions":{"plugins":[{"name":"other","custom":{"keep":true}}]},"vibe":{"severities":{"EK3801":"off"}}}`
			text := "{\n// keep child comment\n\"extends\":\"./base.json\",\"files\":[\"main.ts\"]\n}\n"
			if local {
				text = "{\n// keep child comment\n\"compilerOptions\":{\"plugins\":[{\"name\":\"other\",\"custom\":{\"keep\":true}}, /* keep plugin comment */]},\"vibe\":{\"severities\":{\"EK3801\":\"off\"}},\"files\":[\"main.ts\"]\n}\n"
			}
			for name, body := range map[string]string{"base.json": base, "tsconfig.json": text, "main.ts": "export {}"} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0640); err != nil {
					t.Fatal(err)
				}
			}
			name := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
			sys := &fixSys{fs: osvfs.FS(), cwd: dir}
			if err := migrateSeverityConfigs(sys, name); err != nil {
				t.Fatal(err)
			}
			fixed, err := os.ReadFile(name.AsString())
			if err != nil {
				t.Fatal(err)
			}
			for _, keep := range []string{"@effect/language-service", "other", "custom", "keep", "// keep child comment"} {
				if !strings.Contains(string(fixed), keep) {
					t.Fatalf("missing %q in %s", keep, fixed)
				}
			}
			if local && !strings.Contains(string(fixed), "/* keep plugin comment */") {
				t.Fatal("lost plugin comment")
			}
			unchanged, _ := os.ReadFile(filepath.Join(dir, "base.json"))
			if string(unchanged) != base {
				t.Fatal("changed shared base")
			}
			if err := migrateSeverityConfigs(sys, name); err != nil {
				t.Fatal(err)
			}
			twice, _ := os.ReadFile(name.AsString())
			if string(twice) != string(fixed) {
				t.Fatal("not idempotent")
			}
			info, _ := os.Stat(name.AsString())
			if info.Mode().Perm() != 0640 {
				t.Fatal("changed permissions")
			}
		})
	}
}

// An unresolved base cannot prove which plugin options need preserving.
func TestLintPluginMissingBaseIsNotReplaced(t *testing.T) {
	dir := t.TempDir()
	text := "{\"extends\":\"./missing.json\",\"vibe\":{\"severities\":{\"EK3801\":\"off\"}},\"files\":[\"main.ts\"]}"
	name := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	if err := os.WriteFile(name.AsString(), []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte("export {}"), 0644); err != nil {
		t.Fatal(err)
	}
	sys := &fixSys{fs: osvfs.FS(), cwd: dir}
	if err := migrateSeverityConfigs(sys, name); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(name.AsString())
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != text {
		t.Fatalf("rewrote a config with unresolved inherited plugins: %s", after)
	}
}
