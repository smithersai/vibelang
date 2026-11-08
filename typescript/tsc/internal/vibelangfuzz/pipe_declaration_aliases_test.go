package vibelangfuzz

import (
	"strings"
	"testing"
)

const pipeDeclarationAliasesTarget = "FuzzPipeDeclarationAliases"

func TestPipeDeclarationAliasesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}
