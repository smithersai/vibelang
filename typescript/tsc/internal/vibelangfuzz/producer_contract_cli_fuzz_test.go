package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestProducerContractCLIRepairQuoted(t *testing.T) {
	producerContractVIP(t)
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("chapter 007 lost %q", migrationDeclarationFixQuote)
	}
}
