package vibelang

import "testing"

// A for concurrent whose head holds an is binding hoists declarations before
// the generated loop call. A continue to the loop label still ends one item
// (#502); a nested item's continue to it still crosses a fiber (EK1905).
func TestConcurrentIsHeadLabelContinue(t *testing.T) {
	head := "(const x of (xs is Array(...let ys) ? ys : []))"
	valid := "export effect function main() { const xs: unknown = [1, 2, 3]; const out: number[] = []; outer: for concurrent " + head +
		" { for (const y of [1]) { if (x === 2) continue outer }; out.push(x as number) }; return out }"
	if errors := errorsOf(t, valid); len(errors) != 0 {
		t.Fatalf("want no errors, got %v\n%s", errors, valid)
	}
	limited := "export effect function main() { const xs: unknown = [1, 2, 3]; outer: for concurrent(2) " + head +
		" { if (x === 2) continue outer } }"
	if errors := errorsOf(t, limited); len(errors) != 0 {
		t.Fatalf("want no errors, got %v\n%s", errors, limited)
	}
	nested := "export effect function main() { const xs: unknown = [1, 2, 3]; outer: for concurrent " + head +
		" { for concurrent (const y of [1]) { continue outer } } }"
	if errors := errorsOf(t, nested); len(errors) != 1 || errors[0].Code() != 1905 {
		t.Fatalf("want exactly EK1905, got %v\n%s", errors, nested)
	}
}
