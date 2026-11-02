package vibelangfmt

import (
	"strings"
	"testing"
)

func TestComputedTypeKeyComparison(t *testing.T) {
	for _, source := range []string{
		"error E { [(key)]: number }",
		"error E { [(keys).value]: number }",
		"type E = { [(keys.nested).value]: number }",
		"error E { [(keys.value)]: number; read() { return 1 } }",
		"type E = { [(key)]: number }",
		"class E { [(key)]: number }",
		"interface E { [(keys.value)]: number }",
		"function f(): { [(key)]: number } { return {} }",
	} {
		t.Run(source, func(t *testing.T) {
			after := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(source, "[(key)]", "[key]"), "[(keys.value)]", "[keys.value]"), "(keys).value", "keys.value"), "(keys.nested).value", "keys.nested.value")
			for _, pair := range [][2]string{{source, after}, {after, source}} {
				if err := SameProgram(pair[0], pair[1]); err == nil {
					t.Fatal("computed type key grouping changes native admission and must differ")
				}
			}
		})
	}
	for _, source := range []string{
		"const e = { [(key)]: 1 }",
		"class E { [(key)]() { return 1 } }",
	} {
		t.Run(source, func(t *testing.T) {
			after := strings.ReplaceAll(source, "[(key)]", "[key]")
			if err := SameProgram(source, after); err != nil {
				t.Fatalf("runtime property key grouping is equivalent: %v", err)
			}
		})
	}
}

func TestComputedTypeKeyFormatting(t *testing.T) {
	for _, source := range []string{
		"module native { export type E = { [(key)]: number } }",
		"error E { [(key)]: number }",
		"error E { [(keys).value]: number }",
		"type E = { [(keys.nested).value]: number }",
		"error E { [((keys.value))]: number; read() { return 1 } }",
		"type E = { [(key)]: number }",
		"class E { [(key)]: number }",
		"schema error E { [(key)]: number }",
		"schema S { [(key)]: number }",
		"interface E { [(keys.value)]: number }",
		"function f(): { [(key)]: number } { return {} }",
	} {
		t.Run(source, func(t *testing.T) {
			formatter := func(text string) (string, error) {
				text = strings.ReplaceAll(text, "(keys).value", "keys.value")
				text = strings.ReplaceAll(text, "(keys.nested).value", "keys.nested.value")
				text = strings.ReplaceAll(text, "[((keys.value))]", "[keys.value]")
				text = strings.ReplaceAll(text, "[(keys.value)]", "[keys.value]")
				return strings.ReplaceAll(text, "[(key)]", "[key]"), nil
			}
			once, err := Format("key.vibe", source, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(once, "[(") {
				t.Fatalf("lost computed type key grouping: %s", once)
			}
			twice, err := Format("key.vibe", once, formatter)
			if err != nil || twice != once {
				t.Fatalf("not idempotent: %q, %v", twice, err)
			}
		})
	}
}
