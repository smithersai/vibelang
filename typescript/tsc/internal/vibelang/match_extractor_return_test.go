package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// Chapter 004 requires assignability to Iterable<unknown> | false, including
// the iterator protocol rather than the presence of its symbol alone.
func TestMatcherExtractorReturnAssignability(t *testing.T) {
	for _, tc := range []struct {
		name, result, parameters string
		invalid                  bool
	}{
		{"iterator-data", "{ [Symbol.iterator]: 1 }", "", true},
		{"iterator-optional", "{ [Symbol.iterator]?: () => Iterator<number> }", "", true},
		{"iterator-needs-argument", "{ [Symbol.iterator](n: number): Iterator<number> }", "", true},
		{"iterator-primitive", "{ [Symbol.iterator](): number }", "", true},
		{"next-data", "{ [Symbol.iterator](): { next: number } }", "", true},
		{"next-primitive", "{ [Symbol.iterator](): { next(): number } }", "", true},
		{"result-no-value", "{ [Symbol.iterator](): { next(): { done: false } } }", "", true},
		{"async-only", "AsyncIterable<number>", "", true},
		{"unknown", "unknown", "", true},
		{"true", "true", "", true},
		{"never", "never", "", false},
		{"false", "false", "", false},
		{"any", "any", "", false},
		{"array", "number[]", "", false},
		{"readonly-tuple", "readonly [number, string]", "", false},
		{"string", "string", "", false},
		{"set", "Set<number>", "", false},
		{"generator", "Generator<number, string, unknown>", "", false},
		{"iterable", "Iterable<number>", "", false},
		{"structural", "{ [Symbol.iterator](): { next(): { done: false; value: number } } }", "", false},
		{"branded-false", "false & { readonly marker: unique symbol }", "", false},
		{"branded-union", "(Iterable<unknown> | false) & { readonly marker: unique symbol }", "", false},
		{"generic-union", "T", "<T extends Iterable<unknown> | false>", false},
		{"generic-false", "T", "<T extends false>", false},
		{"generic-iterable", "T", "<T extends Iterable<unknown>>", false},
		{"generic-open", "T", "<T>", true},
	} {
		for _, suffix := range []string{"", " | false"} {
			t.Run(tc.name+suffix, func(t *testing.T) {
				source := "declare function matcher" + tc.parameters + "(s: unknown): " + tc.result + suffix + ";\nexport function f(s: unknown) { return match(s) { when matcher(let value): value; default: 0; } }\n"
				p, f, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == EK0702.Code {
						count++
					} else {
						t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
					}
				}
				want := 0
				if tc.invalid {
					want = 1
				}
				if count != want {
					t.Errorf("EK0702 count %d, want %d\n%s", count, want, source)
				}
			})
		}
	}
}
