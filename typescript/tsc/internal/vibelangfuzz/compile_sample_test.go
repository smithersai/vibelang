package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestCompileSeedSample(t *testing.T) {
	if !testing.Short() {
		t.Skip("short-mode selection regression")
	}
	t.Setenv("VIBELANG_FUZZ_SEEDS", "")
	var seeds []Seed
	for i := 0; i < 100; i++ {
		seeds = append(seeds, Seed{Name: fmt.Sprint(i)})
	}
	seeds[97].Pending = "witness"
	got := shortWitnessSeeds("FuzzCompileSample", seeds, 3)
	if !slices.ContainsFunc(got, func(seed Seed) bool { return seed.Name == "97" }) {
		t.Fatal("pending witness lost")
	}
	for _, seed := range seeds {
		want := seed.Name == "97" || toolsSampled("FuzzCompileSample", seed.Name, 3)
		if slices.ContainsFunc(got, func(s Seed) bool { return s.Name == seed.Name }) != want {
			t.Fatalf("seed %s: sampled %v, want %v", seed.Name, !want, want)
		}
	}
	if len(got) < 15 || len(got) > 55 {
		t.Fatalf("one in 3 of 99 seeds plus a witness sampled %d", len(got))
	}
	t.Setenv("VIBELANG_FUZZ_SEEDS", "all")
	if len(shortWitnessSeeds("FuzzCompileSample", seeds, 3)) != len(seeds) {
		t.Fatal("all mode sampled")
	}
}

func TestCompileSeedsShortSelection(t *testing.T) {
	if !testing.Short() || toolsFuzzing() {
		t.Skip("ordinary short selection only")
	}
	cases, snippets := 0, 0
	for _, input := range CompileSeeds() {
		name := SeedName(input)
		if strings.HasPrefix(name, "case ") {
			cases++
		}
		if strings.HasPrefix(name, "snippet ") {
			snippets++
		}
	}
	pending := 0
	for _, seed := range CaseSeeds() {
		if seed.Pending != "" {
			pending++
		}
	}
	// One in 120 ordinary cases and one in 64 snippets, with room for the
	// spread of a hash sample.
	caseLimit := pending + 2*(len(CaseSeeds())-pending)/120 + 8
	snippetLimit := 2*len(SnippetSeeds())/64 + 8
	if cases > caseLimit || snippets > snippetLimit {
		t.Fatalf("short run has %d case and %d snippet seeds; want <=%d and <=%d", cases, snippets, caseLimit, snippetLimit)
	}
}

func TestParitySampleHasInputs(t *testing.T) {
	inputs := parityInputs()
	for _, seed := range inputs {
		found := false
		for name := range seed.Files {
			if isTypeScript(name) && !isDeclaration(name) {
				found = true
			}
		}
		if !found {
			t.Fatalf("parity sample has no TypeScript input: %s", seed.Name)
		}
	}
	if testing.Short() && !toolsFuzzing() && len(ParitySeeds()) < min(32, len(inputs)) {
		t.Fatalf("parity selected fewer actual inputs than its sample: %d", len(ParitySeeds()))
	}
	selected := map[string]bool{}
	for _, archive := range ParitySeeds() {
		selected[archive] = true
	}
	for _, seed := range inputs {
		if strings.HasSuffix(seed.Name, " typescript/") && !selected[Archive(seed.Files)] {
			t.Errorf("short parity sample lost the explicit TypeScript twin: %s", seed.Name)
		}
	}
}
