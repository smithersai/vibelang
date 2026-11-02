package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-14: only the implicit Effect binding exposes the colliding modules as
// Effect.M. A written binding keeps its ordinary TypeScript meaning, so an
// imported Effect has no Array member.
func TestEffectCollisionNeedsImplicitBinding(t *testing.T) {
	for _, source := range []string{
		"import { Effect } from \"effect\"\nexport const value = Effect.Array.head([1])\n",
		"import { Effect as E } from \"effect\"\nexport const value = E.Array.head([1])\n",
		"import * as Effect from \"effect/Effect\"\nexport const value = Effect.Array.head([1])\n",
		"import { Effect } from \"effect\"\nexport type T = typeof Effect.Array\n",
		"import { Effect } from \"effect\"\nexport type T = Effect.Array.NonEmptyReadonlyArray<number>\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		var codes []string
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.String())
			}
		}
		if len(codes) == 0 {
			t.Errorf("accepted Array on a written Effect binding:\n%s", source)
		} else if !strings.Contains(strings.Join(codes, "\n"), "Array") {
			t.Errorf("unexpected errors for\n%s\n%s", source, strings.Join(codes, "\n"))
		}
	}
	program, file, _, _ := editorProgram(t, "export const value = Effect.Array.head([1])\nexport type T = Effect.Array.NonEmptyReadonlyArray<number>\nexport type Q = typeof Effect.Array\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("the implicit binding lost Effect.M: %s", d.String())
		}
	}
}
