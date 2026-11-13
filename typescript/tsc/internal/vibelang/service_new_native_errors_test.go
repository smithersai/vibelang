package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceNewNativeErrors(t *testing.T) {
	for _, reference := range []bool{false, true} {
		for i, tc := range []struct {
			argument string
			code     int32
		}{
			{"Missing", 2304},
			{"({}).missing", 2339},
			{"((n: number) => n)(\"bad\")", 2345},
			{"null as Missing", 2304},
			{"class { nested }", 7008},
			{"class { nested(): void }", 2391},
			{"class { static nested!: number }", 1255},
			{"new Abstract()", 2511},
			{"new NotConstructor()", 2351},
			{"", 0},
		} {
			t.Run(fmt.Sprintf("reference%v/argument%d", reference, i), func(t *testing.T) {
				fallback := ""
				if reference {
					fallback = "static readonly defaultValue = () => ({ n: 1 });"
				}
				source := "abstract class Abstract {} const NotConstructor = {}; export service S { static readonly key = \"new/S\"; " + fallback + "n: number }; const value = new S(" + tc.argument + ")"
				p, file, _, _ := editorProgram(t, source)
				got := map[int32]int{}
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						got[d.Code()]++
					}
				}
				want := 1
				if tc.code != 0 {
					want++
				}
				if len(got) != want || got[3003] != 1 || tc.code != 0 && got[tc.code] != 1 {
					t.Fatalf("want one EK3003 and independent TS%d, got %v: %s", tc.code, got, source)
				}
			})
		}
	}
}
