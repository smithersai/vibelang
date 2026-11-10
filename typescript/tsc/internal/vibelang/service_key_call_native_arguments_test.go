package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceKeyCallNativeArguments(t *testing.T) {
	for _, reference := range []bool{false, true} {
		for _, wrapped := range []bool{false, true} {
			for _, tc := range []struct {
				key, argument string
				native        int32
			}{
				{"not-callable", "(1)()", 2349},
				{"arity", "((n: number) => n)()", 2554},
				{"too-many", "((n: number) => n)(1, 2)", 2554},
				{"constructor-arity", "new (class { constructor(n: number) {} })()", 2554},
				{"nested-method", "({ method(n: number) {} }).method()", 2554},
				{"callback-arity", "() => ((n: number) => n)()", 2554},
				{"nested-call", "() => (1)()", 2349},
				{"missing-name", "Missing", 2304},
				{"argument-type", "((n: number) => n)(\"bad\")", 2345},
				{"property", "({}).missing", 2339},
				{"clean", "1", 0},
				{"clean-callback", "() => 1", 0},
			} {
				t.Run(fmt.Sprintf("%s/reference%v/wrapped%v", tc.key, reference, wrapped), func(t *testing.T) {
					declaration := `service S { static readonly key = "call/S"; n: number;`
					if reference {
						declaration += `static readonly defaultValue = () => ({ n: 1 });`
					}
					declaration += "}"
					callee := "S"
					if wrapped {
						callee = "(S)"
					}
					source := declaration + callee + "(" + tc.argument + ");"
					p, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					want := 1
					if tc.native != 0 {
						want++
					}
					if len(got) != want || got[9214] != 1 || tc.native != 0 && got[tc.native] != 1 {
						t.Fatalf("want EK9214 and independent TS%d, got %v: %s", tc.native, got, source)
					}
				})
			}
		}
	}
}
