package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-6 retires D229. The old input-fix witnesses now compile unchanged.
func TestHatchCapturesFollowVIP6(t *testing.T) {
	for _, source := range []string{
		"class C {}\nexport effect function main() { return try sync(() => new C()) }",
		"effect function size(value: string | undefined) { if (value === undefined) return 0; return try sync(() => value.length) }",
		"const parse = (text: string): number => Number(text)\nexport effect function invalid(text: string) { return try sync((input: typeof text): ReturnType<typeof parse> => parse(input), text) }",
		"export const f=sync;export const g=callback;export const n=never",
		"const n = 7; export effect function main() { return try sync(() => n + 1) }",
		"const n = 7; export effect function main() { return try callback<number>((resume) => resume(succeed(n + 1))) }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatal(diagnosticWithNotes(d))
				}
			}
		})
	}
}
