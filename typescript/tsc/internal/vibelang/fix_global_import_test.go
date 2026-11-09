package vibelang

import (
	"testing"
)

// Where the rename would change the module's declaration file, or the import
// is not Effect's module under a global's name, EK4842 says nothing.
func TestGlobalImportNotReported(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"another name already", "import { Array as Arr } from \"effect\"\nexport const n = Arr.length([1])\n"},
		{"no global's name", "import { Order } from \"effect\"\nexport const byNumber = Order.Number\n"},
		{"a re-export", "import { Array } from \"effect\"\nexport { Array }\n"},
		{"a default export", "import { Array } from \"effect\"\nexport default Array\n"},
		{"a written type in a local function", "import { Array } from \"effect\"\nfunction first(xs: Array.NonEmptyReadonlyArray<number>) { return xs[0] }\nexport const one = first([1])\n"},
		{"a written type of the module", "import { Array } from \"effect\"\nexport function first(xs: Array.NonEmptyReadonlyArray<number>) { return xs[0] }\n"},
		{"a type parameter's constraint", "import { Array } from \"effect\"\nexport function first<T extends Array.NonEmptyReadonlyArray<number>>(xs: T): number { return xs[0] }\n"},
		{"a type-only import", "import type { Array } from \"effect\"\nexport type Pair = Array.NonEmptyReadonlyArray<number>\n"},
		{"every name taken", "import { Array } from \"effect\"\nconst Arr = 1\nconst EffectArray = 2\nexport const n = Array.length([Arr, EffectArray])\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4842.Code {
					t.Fatalf("unexpected EK4842: %s", d.String())
				}
			}
		})
	}
}
