package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 004, Pattern bindings: an is in a do…while condition binds in the
// loop head. The first body runs with the cells uninitialized, so a direct
// read there is TS2448 (TypeScript adds its TS2454 as for a read before a
// let), a closure's read and a labeled continue compile, and EK4703 no longer
// names the home as unsupported.
func TestDoWhileIsBindingHome(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         []int32
	}{
		{"closure", "export function f(next: () => number) { const reads: Array<() => number> = []; do { reads.push(() => v) } while (next() is let v and if (v < 3)); return reads }", nil},
		{"direct read", "export function f(next: () => number) { let seen = 0; do { seen = v } while (next() is let v); return seen }", []int32{2448, 2454}},
		{"labeled continue", "export function f(next: () => number) { let n = 0; outer: do { n++; if (n < 2) continue outer } while (next() is let v and if (v < 3)); return n }", nil},
		{"skipped binding", "export function f(flags: Array<boolean>) { let i = 0; do { i++ } while ((flags[i] ?? false) || (i is let n and if (n < 3))); return i }", nil},
		{"outer shadow", "export function f(next: () => number) { const v = \"outer\"; const reads: Array<() => number> = []; do { reads.push(() => v) } while (next() is let v and if (v < 3)); return v }", nil},
		{"head does not leak", "export function f(next: () => number) { do {} while (next() is let cell and if (cell < 3)); return cell }", []int32{2304}},
		{"immutable closure", "export function f(next: () => number) { const reads: Array<() => number> = []; do { reads.push(() => v) } while (next() is const v and if (v < 3)); return reads }", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var codes []int32
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 4703 {
					t.Errorf("unsupported-home diagnostic: %v", d)
				}
				codes = append(codes, d.Code())
			}
			slices.Sort(codes)
			if !slices.Equal(codes, tc.want) && !(len(codes) == 0 && len(tc.want) == 0) {
				t.Fatalf("error codes %v, want %v", codes, tc.want)
			}
		})
	}
}
