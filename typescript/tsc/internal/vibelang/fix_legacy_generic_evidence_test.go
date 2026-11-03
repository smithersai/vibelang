package vibelang

import (
	"strings"
	"testing"
)

func TestFixVIPGenericWeakSiblingDoesNotHoldProgram(t *testing.T) {
	for _, tc := range []struct{ name, parameter, argument string }{
		{"undefined", "other?: T", "undefined"},
		{"empty-array", "other: readonly T[]", "[]"},
		{"two-calls", "other: T", "load(2)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := legacyRunsPrelude + "\nfunction check<T>(actual: T, " + tc.parameter + "): boolean { return true }\nexport effect function probe(): boolean!! { return check(load(1), " + tc.argument + ") }\n"
			result, name := fixSourceOptions(t, source, FixOptions{VIPOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if len(result.Refused) > 0 {
				t.Logf("safe refusal: %+v", result.Refused)
				return
			}
			fixed := result.Files[name]
			if fixed == nil || !strings.Contains(fixed.Text, "check(try load(1)") {
				t.Fatalf("first argument inferred its program context without independent evidence: %+v; source=%s", fixed, source)
			}
			if tc.name == "two-calls" && !strings.Contains(fixed.Text, "try load(2)") {
				t.Fatalf("second call also needs its legacy run: %s", fixed.Text)
			}
		})
	}
}
