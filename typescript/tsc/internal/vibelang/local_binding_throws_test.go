package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// Chapter 3: const g = f preserves f's contract.
func TestLocalBindingThrows(t *testing.T) {
	for _, row := range []struct {
		name, tag, binding, call, bound string
		code                            int32
	}{
		{"never", "never", "const again=read;", "again(s)", "", 0},
		{"never-chain", "never", "const first=read; const again=first;", "again(s)", "", 0},
		{"never-parentheses", "never", "const again=((read));", "again(s)", "", 0},
		{"range", "RangeError", "const again=read;", "again(s)", "RangeError", 403},
		{"range-chain", "RangeError", "const first=read; const again=first;", "again(s)", "RangeError", 403},
		{"unknown", "unknown", "const again=read;", "again(s)", "unknown", 403},
		{"union", "RangeError | TypeError", "const again=read;", "again(s)", "RangeError | TypeError", 403},
		{"namespace-never", "never", "const again=foreign.read;", "again(s)", "", 0},
		{"namespace-range", "RangeError", "const again=foreign.read;", "again(s)", "RangeError", 403},
		{"wrapped", "RangeError", "const again=read;", "try Effect.try(()=>again(s))", "", 0},
		{"explicit-type-boundary", "never", "const again:typeof JSON.parse=read;", "again(s)", "SyntaxError", 403},
		{"assertion-boundary", "never", "const again=read as typeof JSON.parse;", "again(s)", "SyntaxError", 403},
		{"mutable-reassign", "never", "let again=read; again=JSON.parse;", "again(s)", "SyntaxError", 403},
		{"const-from-mutable", "never", "let first=read; first=JSON.parse; const again=first;", "again(s)", "SyntaxError", 403},
		{"mutable-source", "never", "let first=read; const again=first;", "again(s)", "SyntaxError", 403},
		{"direct-never", "never", "", "read(s)", "", 0},
		{"direct-range", "RangeError", "", "read(s)", "RangeError", 403},
	} {
		t.Run(row.name, func(t *testing.T) {
			lib := "/** @throws {" + row.tag + "} */\nexport const read: typeof JSON.parse = JSON.parse"

			source := "import {read} from './lib.js'; import * as foreign from './lib.js';\nexport effect function probe(s:string){" + row.binding + " return " + row.call + "}"
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
			errors := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors++
				if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code || !strings.Contains(d.String(), row.bound) {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			want := 0
			if row.code != 0 {
				want = 1
			}
			if errors != want {
				t.Errorf("got %d errors, want %d", errors, want)
			}
		})
	}
}
