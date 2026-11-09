package vibelangfuzz

import (
	"strings"
	"testing"
)

var legacyCallablePatterns = []struct{ key, corpus string }{
	{"promise-client", "alchemy-legacy-promise-client.ts"},
	{"foreign-generator", "alchemy-legacy-foreign-builder.ts"},
	{"parameter-docs", "alchemy-legacy-parameter-docs.ts"},
}

const legacyCallableIdentityQuote = "No other JSDoc difference is allowed, and an authored `@throws` must remain unchanged."

func TestMigrationLegacyCallableContractsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
	if !strings.Contains(SpecText("001-functions.md"), legacyCallableIdentityQuote) {
		t.Fatalf("Chapter 1 no longer says %q", legacyCallableIdentityQuote)
	}
}

func TestMigrationLegacyCallableContractOracleControls(t *testing.T) {
	original := "export interface Shape {\n/** branch doc */\nbranch: { id: string };\n}\nexport declare const read: (scope: Shape) => Shape;\n"
	for _, changed := range []string{
		strings.ReplaceAll(original, "branch doc", "changed doc"),
		strings.ReplaceAll(original, "id: string", "id: number"),
		strings.ReplaceAll(original, "=> Shape", "=> Promise<Shape>"),
	} {
		if diff := compareDeclarationOutputs(t, map[string]string{"main.d.ts": original}, map[string]string{"main.d.ts": changed}); diff == "" {
			t.Fatalf("API oracle accepted a changed callable contract: %s", changed)
		}
	}
}
