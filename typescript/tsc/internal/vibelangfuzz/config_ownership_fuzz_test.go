package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const configOwnershipQuote = "Traverse `extends` only inside the repository and outside `node_modules`; report external configs without editing them."

func TestConfigOwnershipQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), configOwnershipQuote) {
		t.Fatalf("Chapter 007 no longer says %q", configOwnershipQuote)
	}
}

func FuzzConfigOwnership(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"external", "dependency", "owned", "owned-parent", "symlink-external", "symlink-dependency"} {
		f.Add(key, byte(0))
		f.Add(key, byte(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variation byte) {
		if !slices.Contains([]string{"external", "dependency", "owned", "owned-parent", "symlink-external", "symlink-dependency"}, key) {
			key = "external"
		}
		top := t.TempDir()
		root := filepath.Join(top, "repo")
		selected := root
		if key == "owned-parent" {
			selected = filepath.Join(root, "packages", "app")
		}
		mustWrite := func(name, text string) {
			t.Helper()
			if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(name, []byte(text), 0644); err != nil {
				t.Fatal(err)
			}
		}
		mustWrite(filepath.Join(root, ".jj", "marker"), "")
		base := filepath.Join(top, "external", "base.json")
		if key == "dependency" || key == "symlink-dependency" {
			base = filepath.Join(root, "node_modules", "config", "base.json")
		}
		owned := key == "owned" || key == "owned-parent"
		if owned {
			base = filepath.Join(root, "config", "base.json")
		}
		severity := []string{"off", "warning", "error", "suggestion"}[variation%4]
		code := []string{"EK4609", "EK0801"}[(variation>>2)%2]
		legacy, err := json.Marshal(map[string]any{"vibelang": map[string]any{"diagnostics": map[string]string{code: severity}}})
		if err != nil {
			t.Fatal(err)
		}
		original := "// keep the comment\n" + string(legacy) + "\n"
		mustWrite(base, original)
		target := base
		if strings.HasPrefix(key, "symlink-") {
			target = filepath.Join(root, "base-link.json")
			if err := os.Symlink(base, target); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.MkdirAll(selected, 0755); err != nil {
			t.Fatal(err)
		}
		relative, err := filepath.Rel(selected, target)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(relative, ".") {
			relative = "./" + relative
		}
		config, err := json.Marshal(map[string]any{
			"compilerOptions": map[string]any{
				"strict": true, "skipLibCheck": true, "noEmit": true,
				"types": []string{}, "target": "ES2022", "module": "NodeNext",
			},
			"extends": filepath.ToSlash(relative),
			"files":   []string{"main.vibe"},
			"vibe":    map[string]any{"effectGlobals": false, "effectModules": false},
		})
		if err != nil {
			t.Fatal(err)
		}
		name := filepath.Join(selected, "tsconfig.json")
		mustWrite(name, string(config))
		mustWrite(filepath.Join(selected, "main.vibe"), "export const n = 1\n")
		sys := &sidecarParitySystem{fs: w.fs, cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(selected))}
		status := vibelang.Fix(t.Context(), sys, []string{"-p", name})
		if status != 0 {
			t.Fatalf("fix status %d: %s", status, sys.output.String())
		}
		after, err := os.ReadFile(base)
		if err != nil {
			t.Fatal(err)
		}
		if !owned && string(after) != original {
			Gap(t, "FuzzConfigOwnership", key, "VIP-34 rewrote an unowned extended config")
		}
		if owned && (!strings.Contains(string(after), "\"severities\"") || !strings.Contains(string(after), "// keep the comment")) {
			Gap(t, "FuzzConfigOwnership", key, "VIP-34 did not preserve and migrate the owned extended config")
		}
		if !owned && !strings.Contains(sys.output.String(), "not fixed") {
			Gap(t, "FuzzConfigOwnership", key, "VIP-34 omitted the unowned-config refusal receipt")
		}
		if status := vibelang.Fix(t.Context(), sys, []string{"-p", name}); status != 0 {
			t.Fatalf("second fix status %d: %s", status, sys.output.String())
		}
		again, err := os.ReadFile(base)
		if err != nil {
			t.Fatal(err)
		}
		if string(again) != string(after) {
			t.Fatal("second fix changed the extended config")
		}
	})
}
