package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-13's Data.TaggedError counterpart and VIP-29 keep nested TypeScript
// mutability. Only the payload key gains readonly.
func TestErrorPayloadShallowReadonly(t *testing.T) {
	rows := []struct {
		name, fields, body string
		readonly           bool
	}{
		{"nested", "value: { count: number }", "e.value.count = 2", false},
		{"deep", "value: { inner: { count: number } }", "e.value.inner.count = 2", false},
		{"array-object", "value: { count: number }[]", "e.value[0]!.count = 2", false},
		{"tuple-object", "value: [{ count: number }]", "e.value[0].count = 2", false},
		{"optional-object", "value?: { count: number }", "if(e.value) e.value.count = 2", false},
		{"method-parameter", "value: number; change(p: { count: number }): void { p.count = 2 }", "e.change({ count: 1 })", false},
		{"method-return", "value: number; make(): { count: number } { return { count: 1 } }", "e.make().count = 2", false},
		{"method-local", "value: number; change(): void { const p: { count: number } = { count: 1 }; p.count = 2 }", "e.change()", false},
		{"outer-readonly", "value: { count: number }", "e.value = { count: 2 }", true},
		{"explicit-readonly", "value: { readonly count: number }", "e.value.count = 2", true},
		{"array-element", "value: number[]", "e.value[0] = 2", false},
	}
	for _, form := range []string{"error", "schema error"} {
		for _, row := range rows {
			t.Run(form+"/"+row.name, func(t *testing.T) {
				source := fmt.Sprintf("export %s Failure { %s }\nexport function change(e: Failure): void { %s }\n", form, row.fields, row.body)
				program, file, _, _ := editorProgram(t, source)
				var errors []string
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					errors = append(errors, d.String())
					if d.Code() == 2540 {
						count++
					}
				}
				want := 0
				if row.readonly {
					want = 1
				}
				if len(errors) != want || count != want {
					t.Fatalf("want %d readonly errors, got %v\n%s", want, errors, source)
				}
			})
		}
	}
}
