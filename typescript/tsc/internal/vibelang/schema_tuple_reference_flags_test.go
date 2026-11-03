// 006-data.md: required fixed tuple references are checked before and after rest elements
// rule: docs/design/src/006-data.md#21dbcd684e2e8c02
// 006-data.md: required fixed tuple references are checked before and after rest elements
// rule: docs/design/src/006-data.md#97fa5707ebcc82d4
package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestSchemaTupleReferenceFlags(t *testing.T) {
	source := `const Optional = Schema.optionalKey(Schema.Number)
const Alias = Optional
declare const Uncertain: typeof Schema.Number | typeof Optional
schema Direct = readonly [Optional]
schema Aliased = readonly [Alias]
schema Widened = readonly [Uncertain]
schema Outer { readonly slot: readonly [Optional] }
namespace Local { export schema Pair = readonly [Optional] }
schema error Problem { slot: readonly [Optional] }
`
	program, file, _, _ := editorProgram(t, source)
	errors, flags := 0, 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			errors++
			if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
				flags++
			} else {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
		}
	}
	if flags != 6 || errors != 6 {
		t.Fatalf("got %d flag diagnostics / %d errors; want six EK2109", flags, errors)
	}
}

func TestSchemaTupleOptionalReferenceDoesNotSuggestInverseRewrite(t *testing.T) {
	for _, source := range []string{
		`const Optional = Schema.optionalKey(Schema.Number)
export const Pair = Schema.Tuple([Optional])
export type Pair = typeof Pair.Type
`,
		`const Optional = Schema.optionalKey(Schema.Number)
export const Value = Schema.Struct({ pair: Schema.Tuple([Optional]) })
export type Value = typeof Value.Type
`,
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && (d.Code() == EK4841.Code || d.Code() == EK4832.Code) {
				t.Errorf("explicit optional tuple must keep its valid Effect form: %s", d.String())
			}
		}
	}
}
