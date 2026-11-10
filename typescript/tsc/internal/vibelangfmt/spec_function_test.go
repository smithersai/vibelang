package vibelangfmt

import (
	"strings"
	"testing"
)

// VIP-43: the formatter keeps spec before function and proof before its
// block on their lines, and formats both as TypeScript would format a
// function declaration and a block (Appendix F "Interactions").
func TestFormatSpecFunctionsAndProofBlocks(t *testing.T) {
	formatter := dprintFormatter(t)
	source := "spec function countPrefix(xs: readonly boolean[], end: number): number {\n" +
		"proof {\n assume(0 <= end && end <= xs.length)\n    ensures((r) =>   0 <= r && r <= end)\n  decreases(end)\n }\n" +
		"  if (end <= 0) return 0\n  return countPrefix(xs, end - 1) + (xs[end - 1] ? 1 : 0)\n}\n\n" +
		"export function count(xs: readonly boolean[]): number {\n  proof { ensures((r) => r === countPrefix(xs, xs.length)) }\n" +
		"  let total = 0\n  for (let i = 0; i < xs.length; i++) {\n    proof {\n      invariant(0 <= i && i <= xs.length)\n    }\n    if (xs[i]) total++\n  }\n  return total\n}\n"
	once, err := Format("input.vibe", source, formatter)
	if err != nil {
		if projection, encodeErr := encode("input.vibe", source); encodeErr == nil {
			t.Fatalf("%v\nprojection: %s", err, projection.text)
		}
		t.Fatal(err)
	}
	twice, err := Format("input.vibe", once, formatter)
	if err != nil {
		t.Fatal(err)
	}
	if once != twice {
		t.Fatalf("not idempotent:\n%s\nthen:\n%s", once, twice)
	}
	for _, want := range []string{"spec function countPrefix(", "  proof {\n", "ensures((r) => 0 <= r && r <= end)", "    proof {\n      invariant("} {
		if !strings.Contains(once, want) {
			t.Errorf("formatted text has no %q:\n%s", want, once)
		}
	}
	if err := SameProgram(source, once); err != nil {
		t.Fatalf("formatting changed the program: %v\n%s", err, once)
	}
}
