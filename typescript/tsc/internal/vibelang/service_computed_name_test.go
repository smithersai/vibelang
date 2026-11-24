package vibelang

import "testing"

// A service member whose name is computed, such as static [Symbol.iterator],
// is no `key`: checking the service reads only a member named key as one,
// instead of asking a computed name for its text (a compiler panic).
func TestServiceStaticComputedNameIsNoKey(t *testing.T) {
	errors := errorsOf(t, "service Counter {\n  static [Symbol.iterator] = 1\n  n: number\n}\n")
	if len(errors) != 1 || errors[0].Source() != diagnosticSource || errors[0].Code() != 902 {
		t.Fatalf("want exactly one EK0902, got %v", errors)
	}
}
