package vibelang

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstalledEffectSearch(t *testing.T) {
	root := t.TempDir()
	override := filepath.Join(root, "override")
	experiments := filepath.Join(root, "experiments")
	runtime := filepath.Join(root, "runtime")
	install := func(modules string) {
		t.Helper()
		dir := filepath.Join(modules, "effect")
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	check := func(env, want string) {
		t.Helper()
		got, err := findInstalledEffect(env, experiments, runtime)
		if err != nil || got != filepath.Join(want, "effect") {
			t.Fatalf("findInstalledEffect(%q) = %q, %v; want %q", env, got, err, want)
		}
	}
	if _, err := findInstalledEffect("", experiments, runtime); err == nil {
		t.Fatal("missing Effect must fail")
	}
	install(runtime)
	check("", runtime)
	install(experiments)
	check("", experiments)
	if _, err := findInstalledEffect(override, experiments, runtime); err == nil {
		t.Fatal("an explicit missing override must fail instead of testing another Effect version")
	}
	install(override)
	check(override, override)
}
