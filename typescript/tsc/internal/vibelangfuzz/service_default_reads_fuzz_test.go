package vibelangfuzz

import (
	"strings"
	"testing"
)

// Appendix B, the EK4855 row (VIP-9 amended 2026-10-30).
const serviceDefaultReadsDeclarationsQuote = "Ordinary declarations use the native twin's relative specifiers"

const serviceDefaultReadsQuote = "preserving migration of a service's cached `static readonly default` to an equivalent native `Context.Service` class; retain its key, eager initialization, cached identity, field and type reads, mutable shape members and missing-provider failure, or refuse"

func TestServiceDefaultReadsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), serviceDefaultReadsDeclarationsQuote) {
		t.Fatalf("chapter 7 no longer says %q; update the declaration consumer", serviceDefaultReadsDeclarationsQuote)
	}
	if !strings.Contains(SpecText("900-appendices.md"), serviceDefaultReadsQuote) {
		t.Fatalf("Appendix B no longer says %q; update the oracle", serviceDefaultReadsQuote)
	}
}
