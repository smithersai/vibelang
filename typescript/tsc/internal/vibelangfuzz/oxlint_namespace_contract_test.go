package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// RULES9: a chapter edit must invalidate the actual Node property oracle in the spec gate.
func TestOxlintNamespaceContractQuoted(t *testing.T) {
	const quote = "VibeLang resolves a relative `./x.vibe` to source; plain `tsc` reads the compatibility declaration."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter7 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/test/oxlint-namespace.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("the real Oxlint property must use the spec gate quotation")
	}
}
