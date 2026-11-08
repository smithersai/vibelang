package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const relicMigrationTarget = "FuzzRelicControlMigration"
const relicMigrationQuote = "Compiled code gives the same `Exit` as that Effect TypeScript, with finalizers in the same order (VIP-31)."
const relicBindingQuote = "A local declaration or import shadows one, as with any global, so a local `fiber` or `TypeId` silently replaces Effect's."

const relicServiceKeyQuote = "has no derived key: omitting `static readonly key` there is a compile error"

func TestRelicControlMigrationQuoted(t *testing.T) { relicMigrationQuoted(t) }
func relicMigrationQuoted(t testing.TB) {
	chapter, err := os.ReadFile(SpecPath("000-intro.md"))
	if err != nil {
		t.Fatal(err)
	}
	services, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{relicMigrationQuote, relicBindingQuote, relicServiceKeyQuote} {
		if !strings.Contains(string(chapter)+string(services), quote) {
			t.Fatalf("stale migration oracle: %q", quote)
		}
	}
}

func relicNativeNamespaceProject(source string) Project {
	return Project{Files: map[string]string{
		"main.vibe":  source,
		"runtime.ts": `export namespace Control {export const value=7}`,
	}, Config: `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"outDir":"out","paths":{"vibelang-runtime":["./runtime.ts"]}},"files":["main.vibe","runtime.ts"]}`}
}
