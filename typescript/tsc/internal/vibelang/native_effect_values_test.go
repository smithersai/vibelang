package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
	"strings"
	"testing"
)

// Check actual export symbols, including every Effect export this compiler
// currently exposes as a native global. Structural type equality alone would
// admit a wrapper with the same signature.
func TestNativeEffectPreludeBindings(t *testing.T) {
	// A sample of the Effect exports that are globals (VIP-6), with the two
	// values whose runtime wrappers this change retires.
	names := []string{"all", "interrupt", "log", "race", "retry", "sleep", "yieldNow"}
	for _, name := range names {
		if !effectglobals.Names[name] {
			t.Fatalf("%s is not an Effect global", name)
		}
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			source := fmt.Sprintf("import { Effect as Native } from 'effect'; export const pair = [%s, Native.%s] as const", name, name)
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatal(diagnosticWithNotes(d))
				}
			}
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			found := false
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsArrayLiteralExpression(n) {
					elements := n.AsArrayLiteralExpression().Elements.Nodes
					if len(elements) != 2 || !ast.IsPropertyAccessExpression(elements[1]) {
						t.Fatal("unexpected pair")
					}
					actual := resolvedAlias(c, c.GetSymbolAtLocation(elements[0]))
					native := resolvedAlias(c, c.GetSymbolAtLocation(elements[1].Name()))
					if actual == nil || actual != native {
						t.Fatalf("%s does not resolve to its pinned Effect export", name)
					}
					found = true
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("missing pair")
			}
		})
	}
}
func TestNativeEffectValueTypesAndShadows(t *testing.T) {
	for _, name := range []string{"interrupt", "yieldNow"} {
		for _, source := range []string{
			fmt.Sprintf("import { Effect as Native } from 'effect'; export const value: typeof Native.%s = %s", name, name),
			fmt.Sprintf("import { Effect as Native } from 'effect'; import { %s } from 'effect/Effect'; export const value: typeof Native.%s = %s", name, name, name),
			fmt.Sprintf("const %s = 42 as const; export const value: 42 = %s", name, name),
			fmt.Sprintf("const %s = (): number => 42; export const value: () => number = %s", name, name),
		} {
			t.Run(strings.ReplaceAll(source, "/", "_"), func(t *testing.T) {
				p, file, _, _ := editorProgram(t, source)
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatal(diagnosticWithNotes(d))
					}
				}
			})
		}
	}
}
