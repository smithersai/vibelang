package vibelang

import (
	"slices"
	"testing"
)

// The public code is part of a diagnostic's API in the CLI, editor and fix reports.
func TestDiagnosticIdentityAppendixExamples(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"missing-topic", "export const noTopic = 1 |> 2", 2301},
		{"outside-topic", "export const outside = %", 2301},
		{"service-key", "service Users { static key = \"Users\"; get(): string }", 901},
		{"join-operand", "export effect function f() { return join 1 }", 1704},
		{"mixed-pattern", "export function f(n: number) { return match (n) { when 1 and Number or 3: 1; default: 0; } }", 707},
		{"data-extractor", "data D { A { x: number } }; export function f(d: D) { return match (d) { when D.A(let x): x; default: 0; } }", 702},
		{"class-field-list", "error E { x: number }; export function f(e: E) { return match (e) { when E { let x }: x; default: 0; } }", 707},
		{"pipe-control", "export const piped = 1 |> % + 2", 0},
		{"service-control", "service Users { static readonly key = \"Users\"; get(): string }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var codes []int32
			ds := program.GetSyntacticDiagnostics(t.Context(), file)
			ds = append(ds, program.GetSemanticDiagnostics(t.Context(), file)...)
			for _, d := range ds {
				if d.Source() == diagnosticSource {
					codes = append(codes, d.Code())
				}
			}
			if tc.code == 0 && len(codes) > 0 || tc.code != 0 && !slices.Contains(codes, tc.code) {
				t.Fatalf("got %v, want %d", codes, tc.code)
			}
			for _, old := range []int32{1006, 1007, 3008, 4611, 4705, 4706} {
				if slices.Contains(codes, old) {
					t.Fatalf("retired identity %d: %v", old, codes)
				}
			}
		})
	}
}
