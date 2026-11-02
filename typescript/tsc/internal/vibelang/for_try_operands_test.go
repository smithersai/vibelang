package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-20, decided detail 288: the operand domain is Stream<any, any, any>.
// A variance marker alone is not a Stream contract; any and never are assignable.
func TestForTryOperandAssignability(t *testing.T) {
	for _, tc := range []struct {
		name, parameter, setup, body string
		reject                       bool
	}{
		{"any", "rows: any", "", "const n: any = row", false},
		{"never", "rows: never", "", "const n: never = row", false},
		{"stream", "rows: Stream.Stream<number>", "", "const n: number = row", false},
		{"alias", "rows: Rows", "type Rows = Stream.Stream<number>", "const n: number = row", false},
		{"subtype", "rows: Stream.Stream<number> & { label: string }", "", "const n: number = row", false},
		{"constraint", "rows: T", "", "const n: number = row", false},
		{"union", "rows: Stream.Stream<number> | Stream.Stream<string>", "", "const n: number | string = row", false},
		{"missing-channel", "rows: Omit<Stream.Stream<number>, \"channel\">", "", "", true},
		{"missing-pipe", "rows: Omit<Stream.Stream<number>, \"pipe\">", "", "", true},
		{"unknown", "rows: unknown", "", "", true},
		{"optional", "rows: Stream.Stream<number> | undefined", "", "", true},
		{"array", "rows: number[]", "", "", true},
		{"async-iterable", "rows: AsyncIterable<number>", "", "", true},
		{"marker-only", "rows: { readonly [Stream.TypeId]: { readonly _A: () => number; readonly _E: () => never; readonly _R: () => never } }", "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			generic := ""
			if tc.name == "constraint" {
				generic = "<T extends Stream.Stream<number>>"
			}
			source := fmt.Sprintf("import { Stream } from \"effect\"; %s; export effect function consume%s(%s) { for try (const row of rows) { %s } }", tc.setup, generic, tc.parameter, tc.body)
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 2004 && d.Source() == diagnosticSource {
					found = true
					continue
				}
				// Preserve native unknown/nullability errors in addition to
				// the source operand diagnostic (decided detail 288).
				if d.Source() != diagnosticSource && (tc.name == "unknown" && d.Code() == 18046 || tc.name == "optional" && d.Code() == 18048) {
					continue
				}
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if found != tc.reject {
				t.Errorf("EK2004 = %v, want %v", found, tc.reject)
			}
		})
	}
}

func TestForTryOperandLeavesNativeLoops(t *testing.T) {
	for _, source := range []string{
		"export function consume(rows: any): void { for (const row of rows) {} }",
		"export function consume(rows: readonly number[]): void { for (const row of rows) { const n: number = row } }",
		"export async function consume(rows: AsyncIterable<number>): Promise<void> { for await (const row of rows) { const n: number = row } }",
	} {
		p, file, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("changed native loop: %s\n%s", d.String(), source)
			}
		}
	}
}
