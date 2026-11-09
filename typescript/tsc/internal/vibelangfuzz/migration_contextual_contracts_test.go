package vibelangfuzz

import (
	"strings"
	"testing"
)

const contextualContractQuote = "each export's type identical to `tsc`'s in both directions (a type-level check)"

var contextualContractForms = []string{"satisfies", "returned", "generic", "written-control", "direct-control"}

func TestMigrationContextualContractsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
	if !strings.Contains(SpecText("001-functions.md"), contextualContractQuote) {
		t.Fatalf("Chapter 1 no longer says %q", contextualContractQuote)
	}
}

func TestMigrationContextualContractOracleControls(t *testing.T) {
	original := "export declare const plugin: { effect: (ctx: string) => { readonly requirements: \"model\" } };\n"
	changed := strings.ReplaceAll(original, "\"model\"", "\"model\" | \"other\"")
	if diff := compareDeclarationOutputs(t, map[string]string{"main.d.ts": original}, map[string]string{"main.d.ts": changed}); diff == "" {
		t.Fatal("API oracle accepted widened requirements")
	}
}
