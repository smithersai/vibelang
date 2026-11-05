package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-4: ordinary generator bodies are synchronous code outside effect code.
func TestPlainGeneratorThrowContexts(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"statement", "export function* f() { throw \"bad\" }", 1},
		{"yield-nullish", "export function* f(x?: string) { yield x ?? throw \"bad\" }", 1},
		{"yield-conditional", "export function* f(x?: string) { yield x ? x : throw \"bad\" }", 1},
		{"yield-unary", "export function* f() { yield !throw \"bad\" }", 1},
		{"yield-typeof", "export function* f() { yield typeof throw \"bad\" }", 1},
		{"yield-void", "export function* f() { yield void throw \"bad\" }", 1},
		{"unary-expression", "export function* f() { return !throw \"bad\" }", 1},
		{"expression-generator", "export const f = function* () { yield !throw \"bad\" }", 1},
		{"object-generator", "export const f = { *read() { yield !throw \"bad\" } }", 1},
		{"class-generator", "export class Box { *read() { yield !throw \"bad\" } }", 1},
		{"caught-generator", "export function* f() { try { yield !throw \"bad\" } catch {} }", 1},
		{"async-generator-control", "export async function* f() { yield !throw \"bad\" }", 0},
		{"effect-producer-control", "export effect function* f() { yield !throw \"bad\" }", 0},
		{"nested-plain-generator", "export effect function outer() { return function* () { yield !throw \"bad\" } }", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				t.Errorf("unexpected parser diagnostic: %s", d.String())
			}
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 401 {
					count++
					continue
				}
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != tc.want {
				t.Fatalf("EK0401 count=%d, want %d: %s", count, tc.want, tc.source)
			}
		})
	}
}
