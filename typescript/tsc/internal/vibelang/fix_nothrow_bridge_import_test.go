package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// EK0401's bridge module exports its function under the name the file imports
// it by, so the fixed file has no import alias, which repositories that forbid
// renamed imports would reject. A bridge written in the older aliased form
// (raise imported as $raise) is reused rather than duplicated.
func TestFixNothrowBridgeImportHasNoAlias(t *testing.T) {
	const legacy = "module $throw$ts {\nexport function raise(value: unknown): never { throw value }\n}\nimport { raise as $raise } from $throw$ts\n"
	for _, tc := range []struct{ name, source, want string }{
		{"throw", "export function f(n:number):number { if(n<0) throw n; return n }\n", "import { $raise } from $throw$ts"},
		{"call", "export function f(s:string):unknown { return JSON.parse(s) }\n", "import { $invoke } from $call$ts"},
		{"call and throw", "export function f(s:string):unknown { if(s==='') throw s; return JSON.parse(s) }\n", "import { $invoke } from $call$ts"},
		{"legacy bridge reused", legacy + "export function f(n:number):number { if(n<0) throw n; return n }\n", "import { raise as $raise } from $throw$ts"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Sites) != 0 || !strings.Contains(fixed.Text, tc.want) {
				t.Fatalf("want %q: %+v", tc.want, result)
			}
			if strings.Contains(strings.TrimPrefix(fixed.Text, legacy), " as ") {
				t.Fatalf("new bridge import has an alias:\n%s", fixed.Text)
			}
			if strings.Count(fixed.Text, "module $throw$ts") > 1 || strings.Count(fixed.Text, "module $call$ts") > 1 {
				t.Fatalf("bridge duplicated:\n%s", fixed.Text)
			}
			program, after, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), after), program.GetSemanticDiagnostics(t.Context(), after)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed program: %s\n%s", d.String(), fixed.Text)
				}
			}
		})
	}
}
