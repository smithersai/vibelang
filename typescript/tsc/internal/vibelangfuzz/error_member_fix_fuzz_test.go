package vibelangfuzz

import (
	"regexp"
	"strings"
	"testing"
)

func TestErrorMemberFixQuoted(t *testing.T) {
	const importQuote = "Declaration import spelling follows TypeScript's source and tsconfig rules"
	if !strings.Contains(SpecText("007-tooling.md"), importQuote) {
		t.Fatalf("Chapter 7 no longer says %q", importQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}

// Importing a fresh namespace to avoid capture only renames qualified type
// references. Canonicalize that lexical alias, retaining every other token;
// FuzzFix also checks actual contract assignability in both directions.
func errorMigrationDeclaration(text string) string {
	imports := regexp.MustCompile(`(?m)^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from "effect/Schema";\r?\n`)
	for _, match := range imports.FindAllStringSubmatch(text, -1) {
		text = strings.ReplaceAll(text, match[0], "")
		text = strings.ReplaceAll(text, match[1]+".", `import("effect/Schema").`)
	}
	return text
}

func TestErrorMigrationDeclarationNormalizationKeepsTypes(t *testing.T) {
	before := "export declare const value: import(\"effect/Schema\").Class<string>;\n"
	alias := "import * as $Schema from \"effect/Schema\";\nexport declare const value: $Schema.Class<string>;\n"
	changed := "import * as $Schema from \"effect/Schema\";\nexport declare const value: $Schema.Class<number>;\n"
	if errorMigrationDeclaration(before) != errorMigrationDeclaration(alias) {
		t.Fatal("namespace import spelling must retain the same declaration")
	}
	if errorMigrationDeclaration(before) == errorMigrationDeclaration(changed) {
		t.Fatal("normalization hid a type change")
	}
}
