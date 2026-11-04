package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// VIP-4: the annotation on a callable binding overrides its type signature.
func TestIntrinsicBindingThrows(t *testing.T) {
	for _, row := range []struct {
		name, lib, head, body, bound string
		code                         int32
	}{
		{"const", "/** @throws {RangeError} */\nexport const parse: typeof JSON.parse = JSON.parse", "import { parse } from \"./lib.js\"", "return parse(s)", "RangeError", 403},
		{"renamed", "/** @throws {RangeError} */\nexport const parse: typeof JSON.parse = JSON.parse", "import { parse as read } from \"./lib.js\"", "return read(s)", "RangeError", 403},
		{"namespace", "/** @throws {RangeError} */\nexport const parse: typeof JSON.parse = JSON.parse", "import * as foreign from \"./lib.js\"", "return foreign.parse(s)", "RangeError", 403},
		{"never-intrinsic", "/** @throws {RangeError} */\nexport const max: typeof Math.max = Math.max", "import { max } from \"./lib.js\"", "return max(1,2)", "RangeError", 403},
		{"unknown", "/** @throws {unknown} */\nexport const max: typeof Math.max = Math.max", "import { max } from \"./lib.js\"", "return max(1,2)", "unknown", 403},
		{"union", "/** @throws {RangeError | SyntaxError} */\nexport const parse: typeof JSON.parse = JSON.parse", "import { parse } from \"./lib.js\"", "return parse(s)", "RangeError | SyntaxError", 403},
		{"property", "export declare class Tools {\n/** @throws {RangeError} */\nreadonly parse: typeof JSON.parse }\nexport declare const tools: Tools", "import { tools } from \"./lib.js\"", "return tools.parse(s)", "RangeError", 403},
		{"property-signature", "export interface Tools {\n/** @throws {RangeError} */\nreadonly parse: typeof JSON.parse }\nexport declare const tools: Tools", "import { tools } from \"./lib.js\"", "return tools.parse(s)", "RangeError", 403},
		{"never", "/** @throws {never} */\nexport const parse: typeof JSON.parse = JSON.parse", "import { parse } from \"./lib.js\"", "return parse(s)", "", 0},
		{"wrapped", "/** @throws {RangeError} */\nexport const parse: typeof JSON.parse = JSON.parse", "import { parse } from \"./lib.js\"", "return try Effect.try(() => parse(s))", "", 0},
		{"unannotated-never", "export const max: typeof Math.max = Math.max", "import { max } from \"./lib.js\"", "return max(1,2)", "", 0},
		{"intrinsic-default", "", "", "return JSON.parse(s)", "SyntaxError", 403},
	} {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := requirementIdentityProgram(t, row.head+"\nexport effect function probe(s:string){"+row.body+"}", map[string]string{"lib.ts": row.lib})
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
