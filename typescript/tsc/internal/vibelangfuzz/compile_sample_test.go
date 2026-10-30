package vibelangfuzz

import (
	"fmt"
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
	got := shortWitnessSeeds(seeds, 32)
	if len(got) != 33 {
		t.Fatalf("got %d seeds, want 32 ordinary plus pending", len(got))
	}
	if got[0].Name != "97" {
		t.Fatal("pending witness lost")
	}
	again := shortWitnessSeeds(seeds, 32)
	for i := range got {
		if got[i].Name != again[i].Name {
			t.Fatal("sample changed")
		}
	}
	t.Setenv("VIBELANG_FUZZ_SEEDS", "all")
	if len(shortWitnessSeeds(seeds, 32)) != len(seeds) {
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
	if cases > 32+pending || snippets > 16 {
		t.Fatalf("short run has %d case and %d snippet seeds; want <=%d and <=16", cases, snippets, 32+pending)
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
}
