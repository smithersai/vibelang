package vibelangfuzz

import (
	"strings"
	"testing"
)

// Chapter 001: deterministic hygienic generic-data declaration helpers.
// Spec rule: docs/design/src/001-functions.md#72c177467acf2e67
const coverageGenericHelperQuote = "The generic-`data` helper for `data Outcome<A>` is named `$Outcome$Definition`; if the module already declares that name, the compiler appends `$2`, `$3`, … and takes the first free name, so the name is the same on every build (VIP-28, amended)."

func TestCoverageGenericHelperNamesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), coverageGenericHelperQuote) {
		t.Fatal("Chapter 001 generic helper contract changed")
	}
}
func FuzzCoverageGenericHelperNames(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#72c177467acf2e67
	// Chapter 001: deterministic hygienic helper names after occupied preferred names.

	startShortBudget(f)
	rules := dataHelperNameRules()
	for _, c := range rules {
		f.Add(c.name, uint8(0))
		f.Add(c.name, uint8(3))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestCoverageGenericHelperNamesQuoted(t)
		index := -1
		for i, c := range rules {
			if c.name == key {
				index = i
				break
			}
		}
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		c := rules[index]
		c.chapter, c.quote = "001-functions.md", coverageGenericHelperQuote
		checkDataRule(t, w, c, trivia)
	})
}
