package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLegacyVarDeclarations(t *testing.T) {
	for _, test := range []struct {
		name, source string
		count        int
	}{
		{"plain", "export function value(): number { var result = 1; return result }", 1},
		{"top-level", "export var value = 1", 1},
		{"for", "export function value(): number { for (var i = 0; i < 2; i++) {}; return 1 }", 1},
		{"for-in", "export function value(): number { for (var key in { a: 1 }) {}; return 1 }", 1},
		{"for-of", "export function value(): number { for (var item of [1]) {}; return 1 }", 1},
		{"multiple-bindings", "export function value(): number { var first = 1, second = 2; return first + second }", 1},
		{"nested", "export function value(): number { var outer = 1; function inner() { var inside = 2; return inside }; return outer }", 2},
		{"ambient", "declare var provided: number; export { provided }", 1},
		{"effect", "export effect function value() { var result = try Effect.succeed(1); return result }", 1},
		{"unicode-prefix", "// café 😀 var comment\nexport function value(): number { var result = 1; return result }", 1},
		{"let-const", "export function value(): number { let result = 1; const other = 2; return result + other }", 0},
		{"let-loop", "export function value(): number { for (let item of [1]) {}; return 1 }", 0},
		{"properties", "interface Row { var: number }; const row: Row = { var: 1 }; export const value = row.var", 0},
		{"strings-comments", "// var result = 1\nexport const value = \"var result = 1\"", 0},
		{"generated-effect-temporaries", "export effect function value() { const result = try Effect.succeed(1); return result + 1 }", 0},
		{"do-direct", "export function value(): number { return do { var result = 1; result } }", 1},
		{"do-nested", "export function value(): number { return do { { var result = 1 }; result } }", 1},
		{"do-parameter", "export function value(x = do { var result = 1; result }): number { return x }", 1},
		{"using", "export function value(resource: Disposable): number { using handle = resource; return 1 }", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != "EK" || d.Code() != 107 {
					continue
				}
				count++
				if d.Category() != diagnostics.CategoryError {
					t.Errorf("var diagnostic category = %v, want error", d.Category())
				}
				if loc := d.Loc(); file.Text()[loc.Pos():loc.End()] != "var" {
					t.Errorf("diagnostic covers %q, want only var", file.Text()[loc.Pos():loc.End()])
				}
			}
			if count != test.count {
				t.Fatalf("got %d EK0107 diagnostics, want %d: %s", count, test.count, test.source)
			}
		})
	}
}
