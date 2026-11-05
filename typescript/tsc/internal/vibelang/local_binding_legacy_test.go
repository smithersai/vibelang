package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// A legacy trust marker is not a written throws contract for a const alias.
func TestLocalBindingThrowsLegacyMarker(t *testing.T) {
	lib := "/** @vibelang trusted */\nexport const read:typeof JSON.parse=JSON.parse"
	p, f, _, _ := requirementIdentityProgram(t, "import {read} from './lib.js';\nexport effect function probe(s:string){const again=read;return again(s)}", map[string]string{"lib.ts": lib})
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		count++
		if d.Source() != diagnosticSource || d.Code() != 403 || !strings.Contains(d.String(), "SyntaxError") {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
	if count != 1 {
		t.Errorf("got %d errors, want one intrinsic bridge diagnostic", count)
	}
}
