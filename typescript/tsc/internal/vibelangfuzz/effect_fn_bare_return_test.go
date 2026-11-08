package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestEffectFnBareReturnContractsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), fixGeneratorReturnQuote) {
		t.Fatal("quick-fix preservation rule changed")
	}
}
