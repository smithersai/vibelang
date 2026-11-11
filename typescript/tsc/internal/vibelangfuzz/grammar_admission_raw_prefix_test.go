package vibelangfuzz

import "testing"

// TestGrammarAdmissionRawPrefixFrozen checks that the archived raw prefix
// still names live seeds: each key once, each present once in
// grammarAdmissionSeeds. The order of grammarAdmissionSeeds itself is free.
func TestGrammarAdmissionRawPrefixFrozen(t *testing.T) {
	seen := map[string]int{}
	for _, s := range grammarAdmissionSeeds {
		seen[s.key]++
	}
	named := map[string]bool{}
	for i, key := range grammarAdmissionRawPrefix {
		if named[key] {
			t.Errorf("raw prefix %d repeats %q", i, key)
		}
		named[key] = true
		if seen[key] != 1 {
			t.Errorf("raw prefix %d names %q, which grammarAdmissionSeeds holds %d times", i, key, seen[key])
		}
	}
	// The archived raw inputs select by first byte: the three regression
	// witnesses pin bytes 'b', 'c' and '}' to their programs.
	for _, want := range []struct{ raw, key string }{
		{"b810000100000000010", grammarAdmissionRawPrefix[int('b')%grammarAdmissionRawSeeds]},
		{"c20a20-", grammarAdmissionRawPrefix[int('c')%grammarAdmissionRawSeeds]},
		{"}1709X78!0\xc01%", grammarAdmissionRawPrefix[int('}')%grammarAdmissionRawSeeds]},
	} {
		if got := grammarAdmissionSeed(want.key).key; got != want.key {
			t.Errorf("raw %q: seed %q resolved to %q", want.raw, want.key, got)
		}
	}
}
