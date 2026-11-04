package vibelangfuzz

import (
	"maps"
	"testing"
)

// A module rename moves its body's diagnostics to the supplemental file its
// new name selects; the oracle keys them by the old name, and leaves every
// other file's keys alone. File names encode each character outside
// [a-z0-9_] (VIP-40), so fuzzFresh0 is fuzz-46-resh0 and Text is -54-ext.
func TestConsistencyModuleFilesRenamed(t *testing.T) {
	got := consistencyModuleFilesRenamed(map[string]int{
		"main.vibe.fuzz-46-resh0.ts: TS2304 (category 1)":  2,
		"main.vibe: EK4008 (category 1)":                   1,
		"other.vibe.fuzz-46-resh0.ts: TS1434 (category 1)": 1,
		"main.vibe.fuzz-46-resh0x.ts: TS2304 (category 1)": 1,
	}, "Text", "fuzzFresh0")
	want := map[string]int{
		"main.vibe.-54-ext.ts: TS2304 (category 1)":        2,
		"main.vibe: EK4008 (category 1)":                   1,
		"other.vibe.-54-ext.ts: TS1434 (category 1)":       1,
		"main.vibe.fuzz-46-resh0x.ts: TS2304 (category 1)": 1,
	}
	if !maps.Equal(got, want) {
		t.Fatalf("consistencyModuleFilesRenamed = %v, want %v", got, want)
	}
}
