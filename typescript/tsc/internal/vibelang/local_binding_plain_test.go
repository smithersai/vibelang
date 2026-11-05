package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// Chapter 3 rejects known throwing calls in plain code and calls never directly.
func TestLocalBindingThrowsPlain(t *testing.T) {
	for _, row := range []struct {
		name, lib string
		code      int32
	}{
		{"never", "/** @throws {never} */\nexport declare const read:typeof JSON.parse", 0},
		{"range", "type Reader=(s:string)=>string\n/** @throws {RangeError} */\nexport declare const read:Reader", 401},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := requirementIdentityProgram(t, "import {read} from './lib.js';\nexport function probe(s:string){const again=read;return again(s)}", map[string]string{"lib.ts": row.lib})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			want := 0
			if row.code != 0 {
				want = 1
			}
			if count != want {
				t.Errorf("got %d errors, want %d", count, want)
			}
		})
	}
}
