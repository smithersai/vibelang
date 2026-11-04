package vibelang

import (
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestAbstractSchemaClassFixKeepsFamilyRegistration(t *testing.T) {
	for _, source := range []string{
		"export abstract schema error Root { code: string }\n",
		"export abstract schema error Empty {}\n",
		"const Schema = 0; const $LegacySchemaErrorFamily = 1; const $ErrorSchemaFamily = 2\nexport abstract schema error Root { code: string }\n",
	} {
		fixed := applyQuickFixOf(t, source, 1308, diagnostics.CategoryWarning)
		if !strings.Contains(fixed, "$schemaErrorFamily as ") || !strings.Contains(fixed, "static {") {
			t.Fatalf("schema family registration omitted:\n%s", fixed)
		}
		if errors := errorsOf(t, fixed); len(errors) != 0 {
			t.Fatalf("fixed errors: %v\n%s", errors, fixed)
		}
		before, after := layerMigrationDeclarations(t, source), layerMigrationDeclarations(t, fixed)
		if canonicalSchemaDeclaration(before) != canonicalSchemaDeclaration(after) {
			t.Fatalf("schema declaration bytes changed:\nbefore:\n%s\nafter:\n%s", before, after)
		}
	}
}

// A capture-free namespace import changes only the spelling of references to
// the same effect/Schema exports. Keep every other declaration token exact.
func canonicalSchemaDeclaration(text string) string {
	imports := regexp.MustCompile(`(?m)^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from "effect/Schema";\r?\n`)
	for _, match := range imports.FindAllStringSubmatch(text, -1) {
		text = strings.ReplaceAll(text, match[0], "")
		text = strings.ReplaceAll(text, match[1]+".", `import("effect/Schema").`)
	}
	return text
}
