package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The generated helper and an explicit user import name the same absent
// dependency. Other missing imports and independent type errors survive.
func TestMissingRuntimeExplicitImports(t *testing.T) {
	for _, tc := range []struct {
		name, imports string
		other         bool
	}{
		{"one value import", `import { Experimental as Existing } from "vibelang-runtime"`, false},
		{"two value imports", `import { Experimental as Existing } from "vibelang-runtime"
import * as More from "vibelang-runtime"`, false},
		{"independent missing package", `import { Experimental as Existing } from "vibelang-runtime"
import { absent } from "another-missing-package"`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tc.imports + "\nexport effect function value() { return 1 }\nexport const independent: number = 'bad'\n"
			program, _, _, _ := editorProgramWith(t, source, map[string]string{"effect": "packages/runtime/node_modules/effect"})
			for repeat := 0; repeat < 2; repeat++ {
				counts := map[string]int{}
				var all []string
				for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					all = append(all, fmt.Sprintf("%d: %s", d.Code(), diagnosticWithNotes(d)))
					switch {
					case d.Code() == 2307 && strings.Contains(d.String(), "'vibelang-runtime'"):
						counts["runtime"]++
					case d.Code() == 2307 && strings.Contains(d.String(), "'another-missing-package'"):
						counts["other"]++
					case d.Code() == 2322:
						counts["independent"]++
					default:
						t.Fatalf("unexpected error: %s", d.String())
					}
				}
				wantOther := 0
				if tc.other {
					wantOther = 1
				}
				if counts["runtime"] != 1 || counts["other"] != wantOther || counts["independent"] != 1 {
					t.Fatalf("dependency counts=%v, want runtime=1 other=%d independent=1; all=%v", counts, wantOther, all)
				}
			}
		})
	}
}
