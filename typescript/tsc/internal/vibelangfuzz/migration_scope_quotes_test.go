package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationSchemaScopeQuoted(t *testing.T) {
	quotes := map[string]string{
		"006-data.md":  "In a schema type, an identifier or qualified name is looked up as a value and must satisfy Effect's `Schema.Top`; a type of the same name is not expanded.",
		"000-intro.md": "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.",
	}
	source, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/test/eslint/schema-scope.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	for chapter, quote := range quotes {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
		if !strings.Contains(string(source), quote) {
			t.Fatalf("schema scope property no longer quotes %q", quote)
		}
	}
}
