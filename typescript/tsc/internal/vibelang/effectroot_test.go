package vibelang

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestEffectRootNamesMatchEffect checks effectRootNames against the root of
// the installed effect package: every namespace and function the root
// exports, except the names the runtime's prelude supplies, with the module
// each comes from.
func TestEffectRootNamesMatchEffect(t *testing.T) {
	index, err := os.ReadFile(filepath.Join(installedEffect(t), "dist", "index.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	source := regexp.MustCompile(`(?s)/\*\*.*?\*/`).ReplaceAllString(string(index), "")
	want := map[string]effectRootExport{}
	for _, m := range regexp.MustCompile(`(?m)^export \* as (\w+) from "\./([A-Za-z/]+)\.ts";`).FindAllStringSubmatch(source, -1) {
		want[m[1]] = effectRootExport{module: "effect/" + m[2], namespace: true}
	}
	if m := regexp.MustCompile(`export \{([^}]*)\} from "\./Function\.ts"`).FindStringSubmatch(source); m != nil {
		for _, name := range strings.Split(m[1], ",") {
			if name = strings.TrimSpace(name); name != "" {
				want[name] = effectRootExport{module: "effect/Function"}
			}
		}
	}
	for name := range preludeModules {
		delete(want, name)
	}
	for name, export := range want {
		if got, ok := effectRootNames[name]; !ok || got != export {
			t.Errorf("effect's root exports %s from %s (namespace %v); effectRootNames has %+v", name, export.module, export.namespace, got)
		}
	}
	for name := range effectRootNames {
		if _, ok := want[name]; !ok {
			t.Errorf("effectRootNames has %s, which effect's root does not export", name)
		}
	}
}
