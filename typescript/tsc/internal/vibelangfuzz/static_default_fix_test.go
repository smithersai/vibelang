package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const staticDefaultEagerQuote = "The initializer runs once, eagerly at the declaration's existing execution point, in source order"

func staticDefaultChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), "A rewrite that can't preserve types, behavior and declaration output refuses at that site.") {
		t.Fatal("chapter 007 migration preservation rule changed")
	}
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), staticDefaultEagerQuote) {
		t.Fatalf("missing quote %q", staticDefaultEagerQuote)
	}
}
func TestStaticDefaultFixQuoted(t *testing.T) { staticDefaultChapter(t) }

var staticDefaultFixKeys = []string{"typed-object", "untyped-object", "literal-data", "readonly", "recursive", "nested", "shadow", "exported-stays", "comment-stays", "reference-stays", "native-stays", "plain-join-init", "mutable-shape", "type-reads", "type-reads-inferred"}

// Consumers need the same real dependencies as the source project. Reuse
// the workspace's installed packages without modifying the shared API gate.
func compareServiceDefaultDeclarations(t *testing.T, w *Workspace, before, after *Result) string {
	t.Helper()
	dirs := []string{t.TempDir(), t.TempDir()}
	for i, outputs := range []map[string]string{before.Outputs, after.Outputs} {
		if err := os.WriteFile(filepath.Join(dirs[i], "package.json"), []byte(`{"type":"module"}`), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(w.Dir, "node_modules"), filepath.Join(dirs[i], "node_modules")); err != nil {
			t.Fatal(err)
		}
		count := 0
		for file, text := range outputs {
			if !isDeclaration(file) {
				continue
			}
			if err := writeInside(dirs[i], file, text); err != nil {
				t.Fatal(err)
			}
			count++
		}
		if count == 0 {
			t.Fatal("project emitted no declarations")
		}
	}
	return compareDeclarationTrees(t, dirs[0], dirs[1])
}
