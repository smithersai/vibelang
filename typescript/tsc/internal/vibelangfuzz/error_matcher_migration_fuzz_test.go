package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const errorMatcherMigrationQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestErrorMatcherMigrationQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", errorMatcherMigrationQuote)
}

// The preserving repair must retain the declaration's own-matcher dispatch:
// concrete and schema declarations own a tag matcher, legacy abstract plain
// roots use native class matching. Runtime Exit/API preservation is checked by
// the reserved-error-payload compiler case.
func FuzzErrorMatcherMigration(f *testing.F) {
	startShortBudget(f)
	keys := []string{"plain-abstract", "plain-concrete", "schema-abstract", "schema-concrete"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		chapterSays(t, "007-tooling.md", errorMatcherMigrationQuote)
		schema, abstract := false, true
		switch key {
		case "plain-concrete":
			abstract = false
		case "schema-abstract":
			schema = true
		case "schema-concrete":
			schema, abstract = true, false
		default:
			key = "plain-abstract"
		}
		form, prefix := "error", ""
		if schema {
			form = "schema error"
		}
		if abstract {
			prefix = "abstract "
		}
		field := []string{"_tag: string", "readonly _tag: string", "_tag /* key */: string", "'_tag': string"}[mode%4]
		source := "const $ErrorMatcher = 0;\nexport " + prefix + form + " Base { " + field + "; id: string }\n"
		if mode&4 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		before := toolsCompile(t, w, "FuzzErrorMatcherMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := source
		for name, file := range result.Files {
			if strings.HasSuffix(name.AsString(), "/main.vibe") {
				fixed = file.Text
			}
		}
		if fixed == source || !strings.Contains(fixed, prefix+"class Base extends") {
			Gap(t, "FuzzErrorMatcherMigration", key, "expected preserving native class repair: %s", fixed)
		}
		if strings.Contains(fixed, "$schemaErrorMatcher as") != (schema || !abstract) {
			Gap(t, "FuzzErrorMatcherMigration", key, "repair changed matcher dispatch: %s", fixed)
		}
		after := toolsCompile(t, w, "FuzzErrorMatcherMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzErrorMatcherMigration", key, "repair introduced diagnostics: %v", after.Diagnostics)
		}
	})
}
