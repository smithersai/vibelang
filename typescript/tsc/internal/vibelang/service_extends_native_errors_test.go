package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceExtendsNativeErrors(t *testing.T) {
	for _, kind := range []string{"service", "reference", "native"} {
		for _, tc := range []struct{ key, base string }{
			{"type-argument", "S<Missing>"},
			{"assertion", "(S as typeof S & { n: Missing })"},
			{"satisfies", "(S satisfies typeof S & { n: Missing })"},
			{"comma", "(Missing, S)"},
			{"conditional", "(Missing ? S : S)"},
			{"nested-class", "((class Inner { n: Missing }), S)"},
			{"nested-property", "((class Inner { value = ({}).missing }), S)"},
			{"nested-call", "(((n: number) => n)(\"bad\"), S)"},
		} {
			t.Run(kind+"/"+tc.key, func(t *testing.T) {
				head := "export service S { static readonly key = \"heritage/S\"; value: number }"
				want := 1
				if kind == "reference" {
					head = "export service S { static readonly key = \"heritage/S\"; static readonly defaultValue = () => ({value: 1}); value: number }"
				}
				if kind == "native" {
					head = "export class S {}"
					want = 0
				}
				source := fmt.Sprintf("%s; export class X extends %s {}", head, tc.base)
				p, file, _, _ := editorProgram(t, source)
				got := map[int32]int{}
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						got[d.Code()]++
					}
				}
				native := int32(2304)
				if tc.key == "nested-property" {
					native = 2339
				}
				if tc.key == "nested-call" {
					native = 2345
				}
				if got[3002] != want || got[native] != 1 {
					t.Fatalf("want one EK3002 and TS%d, got %v: %s", native, got, source)
				}
			})
		}
	}
}
