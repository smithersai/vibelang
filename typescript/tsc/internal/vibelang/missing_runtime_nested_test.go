package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The handler's missing contextual type is caused by the absent helper.
// A nested source arrow's untyped parameter is independent and must survive.
func TestMissingRuntimeNestedImplicitAny(t *testing.T) {
	for _, tc := range []struct {
		name, parameter, argument string
		code                      int32
	}{
		{"simple", "x", "0", 7006},
		{"rest", "...xs", "0", 7019},
		{"destructured", "{ n }", "{ n: 1 }", 7031},
	} {
		for _, installed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/installed=%v", tc.name, installed), func(t *testing.T) {
				source := fmt.Sprintf(`export effect function value() {
 return Effect.fail("bad") catch (_e) => {
  const inner = (%s): number => 1
  return inner(%s)
 }
}`, tc.parameter, tc.argument)
				packages := map[string]string{"effect": "packages/runtime/node_modules/effect"}
				if installed {
					packages["vibelang-runtime"] = "packages/runtime"
				}
				program, _, _, _ := editorProgramWith(t, source, packages)
				counts := map[int32]int{}
				var printed []string
				for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						counts[d.Code()]++
						printed = append(printed, fmt.Sprintf("%d: %s", d.Code(), diagnosticWithNotes(d)))
					}
				}
				runtime := 1
				if installed {
					runtime = 0
				}
				if counts[tc.code] != 1 || counts[2307] != runtime || len(printed) != runtime+1 {
					t.Fatalf("want independent TS%d=1, runtime TS2307=%d; counts=%v; diagnostics=%v", tc.code, runtime, counts, printed)
				}
			})
		}
	}
}
