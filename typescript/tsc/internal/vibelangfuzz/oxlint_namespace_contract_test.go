package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// RULES9: a chapter edit must invalidate the actual Node property oracle in the spec gate.
func TestOxlintNamespaceContractQuoted(t *testing.T) {
	const quote = "TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 1 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/test/oxlint-namespace.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("the real Oxlint property must use the spec gate quotation")
	}
}
