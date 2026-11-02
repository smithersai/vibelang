package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaConstructorGateQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"003-failures.md": "a constructor in an `error` or `schema error` body",
		"007-tooling.md":  "`vibelang --fix` keeps the existing safe-fix checks and refusal rules.",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
	rules, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/rules.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rules), "A `Schema.TaggedError` class stays a class when EK4837 says it has no quick fix") {
		t.Fatal("update the retained-constructor migration oracle")
	}
}
