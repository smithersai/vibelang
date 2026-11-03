package vibelang

import (
	"strings"
	"testing"
)

func TestGenericArgumentRunFixContracts(t *testing.T) {
	for _, tc := range []struct {
		name, argument, contract string
		run                      bool
	}{
		{"inferred", "job", "", true},
		{"written-success", "job", ": number!!", true},
		{"written-unknown", "job", ": unknown!!", true},
		{"failure-refused", "failed", ": number!!", false},
		{"array-not-run", "[job]", "", false},
		{"returned-data", "job", "", false},
		{"explicit-intent", "job", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "function take<T>(x: T): number { return 1 }\nexport effect function main(job: number!!, failed: number!string)" + tc.contract + " { return take(" + tc.argument + ") }\n"
			if tc.name == "returned-data" {
				source = "export effect function main(job: number!!) { return job }\n"
			}
			if tc.name == "explicit-intent" {
				source = strings.Replace(source, "return take(", "return take<number!!>(", 1)
			}
			result, name := fixSourceOptions(t, source, FixOptions{})
			if tc.run {
				if result.Files[name] == nil || !strings.Contains(result.Files[name].Text, "take(try job)") {
					t.Fatalf("missing generic argument run fix: files=%+v refused=%+v", result.Files, result.Refused)
				}
			} else if result.Files[name] != nil && result.Files[name].Text != source {
				t.Fatalf("unsafe run repair: %s", result.Files[name].Text)
			}
		})
	}
}

// VIP-only migration preserves the historical held value. Its generic
// diagnostic must not run an identifier that was already program data.
func TestGenericArgumentRunFixKeepsVIPOnlyValue(t *testing.T) {
	source := legacyRunsPrelude + "declare function check<T, U>(actual: T, other: U): T\nconst other = Effect.succeed(2)\nexport effect function f() { return check(load(1), other) }\n"
	result, name := fixVIPOnlySource(t, source)
	if result.Files[name] == nil || !strings.Contains(result.Files[name].Text, "check(try load(1), other)") || len(result.Refused) != 0 {
		t.Fatalf("ordinary generic repair changed VIP-only held data: fixed=%+v refused=%+v", result.Files[name], result.Refused)
	}
}
