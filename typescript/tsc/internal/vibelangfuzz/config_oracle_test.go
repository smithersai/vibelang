package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// TestConfigOracleMatchesCompiler reads in seconds what FuzzConfig finds in
// minutes after a merge: Chapter 28's frozen options table lists a code the
// compiler no longer accepts. Retiring a code therefore takes, with it, an
// accepted VIP's entry in configCodeAdjustable or a FuzzConfig line in
// testdata/pending. EK1016 and then EK2004 turned main red without one.
func TestConfigOracleMatchesCompiler(t *testing.T) {
	for _, code := range Facts().Adjustable {
		name := fmt.Sprintf("EK%d", code)
		accepted := slices.Contains(core.VibeLangAdjustableCodes, name)
		if !configCodeAdjustable(code) {
			if accepted {
				t.Errorf("configCodeAdjustable retires %s, but the compiler accepts it", name)
			}
			continue
		}
		if _, recorded := Pending("FuzzConfig", "ek:"+name); !accepted && !recorded {
			t.Errorf("Chapter 28's options table lists %s and the compiler rejects it: add it to configCodeAdjustable, citing the VIP, or give FuzzConfig a pending line", name)
		}
	}
}
