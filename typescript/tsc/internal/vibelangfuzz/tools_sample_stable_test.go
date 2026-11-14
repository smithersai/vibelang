package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// Adding or removing one seed changes no other seed's membership in the
// sample, so a seed run checks the same programs it did before.
func TestToolsSampleStable(t *testing.T) {
	t.Setenv("VIBELANG_FUZZ_SEEDS", "")
	var seeds []Seed
	for i := range 4000 {
		seeds = append(seeds, Seed{Name: fmt.Sprintf("case-%04d", i)})
	}
	sample := func(seeds []Seed) map[string]bool {
		names := map[string]bool{}
		for _, seed := range toolsSample("FuzzStable", seeds, 100, 1, nil) {
			names[seed.Name] = true
		}
		return names
	}
	before := sample(seeds)
	if len(before) < 20 || len(before) > 60 {
		t.Fatalf("one in 100 of 4000 seeds sampled %d", len(before))
	}
	for _, edit := range []struct {
		name    string
		seeds   []Seed
		changed string
	}{
		{"add", slices.Insert(slices.Clone(seeds), 1000, Seed{Name: "case-0999a"}), "case-0999a"},
		{"remove", slices.Delete(slices.Clone(seeds), 1000, 1001), "case-1000"},
		{"remove-first", seeds[1:], "case-0000"},
	} {
		t.Run(edit.name, func(t *testing.T) {
			after := sample(edit.seeds)
			var moved []string
			for name := range before {
				if !after[name] && name != edit.changed {
					moved = append(moved, "-"+name)
				}
			}
			for name := range after {
				if !before[name] && name != edit.changed {
					moved = append(moved, "+"+name)
				}
			}
			slices.Sort(moved)
			if len(moved) > 0 {
				t.Fatalf("%s %s moved %d other seeds in or out of the sample: %s", edit.name, edit.changed, len(moved), strings.Join(moved[:min(6, len(moved))], " "))
			}
		})
	}
}

// Each target salts the hash, so two targets with the same rate check
// different programs, and the seeds that must run are always kept.
func TestToolsSampleSaltAndMust(t *testing.T) {
	t.Setenv("VIBELANG_FUZZ_SEEDS", "")
	var seeds []Seed
	for i := range 2000 {
		seeds = append(seeds, Seed{Name: fmt.Sprintf("case-%04d", i)})
	}
	must := func(seed Seed) bool { return strings.HasSuffix(seed.Name, "7") }
	a := toolsSample("FuzzA", seeds, 50, 1, must)
	b := toolsSample("FuzzB", seeds, 50, 1, must)
	if slices.EqualFunc(a, b, func(x, y Seed) bool { return x.Name == y.Name }) {
		t.Fatal("two salts sampled the same seeds")
	}
	for _, sample := range [][]Seed{a, b} {
		kept := 0
		for _, seed := range sample {
			if must(seed) {
				kept++
			}
		}
		if kept != 200 {
			t.Fatalf("kept %d of the 200 seeds that must run", kept)
		}
	}
	if got := toolsSample("FuzzA", seeds, 0, 1, must); len(got) != 200 {
		t.Fatalf("every 0 kept %d seeds, want only the 200 that must run", len(got))
	}
}
