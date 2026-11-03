package vibelangfuzz

import (
	"maps"
	"testing"
)

// A module rename moves its body's diagnostics to the supplemental file its
// new name selects; the oracle keys them by the old name, and leaves every
// other file's keys alone.
func TestConsistencyModuleFilesRenamed(t *testing.T) {
	got := consistencyModuleFilesRenamed(map[string]int{
		"main.vibe.fuzzfresh0.ts: TS2304 (category 1)":  2,
		"main.vibe: EK4008 (category 1)":                1,
		"other.vibe.fuzzfresh0.ts: TS1434 (category 1)": 1,
		"main.vibe.fuzzfresh0x.ts: TS2304 (category 1)": 1,
	}, "Text", "fuzzFresh0")
	want := map[string]int{
		"main.vibe.text.ts: TS2304 (category 1)":        2,
		"main.vibe: EK4008 (category 1)":                1,
		"other.vibe.text.ts: TS1434 (category 1)":       1,
		"main.vibe.fuzzfresh0x.ts: TS2304 (category 1)": 1,
	}
	if !maps.Equal(got, want) {
		t.Fatalf("consistencyModuleFilesRenamed = %v, want %v", got, want)
	}
}
