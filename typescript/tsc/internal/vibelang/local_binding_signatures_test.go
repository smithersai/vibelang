package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// VIP-4: a callable binding's annotation overrides the type signature.
func TestLocalBindingThrowsSignatures(t *testing.T) {
	for _, row := range []struct {
		name, lib, bound, absent string
		code                     int32
	}{
		{"alias-never", "type Reader=(s:string)=>string\n/** @throws {never} */\nexport declare const read:Reader", "", "", 0},
		{"alias-range", "type Reader=(s:string)=>string\n/** @throws {RangeError} */\nexport declare const read:Reader", "RangeError", "", 403},
		{"alias-unknown", "type Reader=(s:string)=>string\n/** @throws {unknown} */\nexport declare const read:Reader", "unknown", "", 403},
		{"interface-never", "interface Reader{(s:string):string}\n/** @throws {never} */\nexport declare const read:Reader", "", "", 0},
		{"interface-range", "interface Reader{(s:string):string}\n/** @throws {RangeError} */\nexport declare const read:Reader", "RangeError", "", 403},
		{"signature-never", "/** @throws {Error} */\nexport declare function base(s:string):string\n/** @throws {never} */\nexport declare const read:typeof base", "", "", 0},
		{"signature-range", "/** @throws {Error} */\nexport declare function base(s:string):string\n/** @throws {RangeError} */\nexport declare const read:typeof base", "RangeError", "", 403},
		{"function-control", "/** @throws {RangeError} */\nexport declare function read(s:string):string", "RangeError", "", 403},
		{"alias-comment-control", "/** @throws {RangeError} */\ntype Reader=(s:string)=>string\nexport declare const read:Reader", "", "RangeError", 403},
	} {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := requirementIdentityProgram(t, "import {read} from './lib.js';\nexport effect function probe(s:string){const first=read;const again=first;return again(s)}", map[string]string{"lib.ts": row.lib})
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if row.code == 0 || d.Source() != diagnosticSource || d.Code() != row.code || !strings.Contains(d.String(), row.bound) || (row.absent != "" && strings.Contains(d.String(), row.absent)) {
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
