package vibelangfuzz

import (
	"flag"
	"strconv"
	"testing"
)

func TestToolsSampleModes(t *testing.T) {
	var seeds []Seed
	for i := range 10 {
		seeds = append(seeds, Seed{Name: strconv.Itoa(i)})
	}
	for _, test := range []struct {
		name, all, fuzz string
		want            int
	}{
		{"short", "", "", 2},
		{"campaign", "", "FuzzParse", 4},
		{"all-seeds", "all", "", 10},
		{"all-seeds-campaign", "all", "FuzzParse", 10},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("VIBELANG_FUZZ_SEEDS", test.all)
			fuzz := flag.Lookup("test.fuzz")
			old := fuzz.Value.String()
			if err := fuzz.Value.Set(test.fuzz); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = fuzz.Value.Set(old) })
			got := toolsSample(seeds, 2, 4, nil)
			if len(got) != test.want {
				t.Fatalf("selected %d of %d seeds, want %d", len(got), len(seeds), test.want)
			}
		})
	}
}
