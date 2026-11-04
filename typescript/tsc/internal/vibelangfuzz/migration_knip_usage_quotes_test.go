package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationKnipUsageQuoted(t *testing.T) {
	var sources []string
	for _, name := range []string{"knip-type-query.property.test.mjs", "knip-public.property.test.mjs"} {
		source, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/test", name))
		if err != nil {
			t.Fatal(err)
		}
		sources = append(sources, string(source))
	}
	for chapter, quote := range map[string]string{
		"007-tooling.md": "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`.",
		"000-intro.md":   "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
		for _, source := range sources {
			if !strings.Contains(source, quote) {
				t.Fatalf("Knip property no longer cites %q", quote)
			}
		}
	}
}
