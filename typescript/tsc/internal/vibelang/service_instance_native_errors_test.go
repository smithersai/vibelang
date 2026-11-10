package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceInstanceNativeErrors(t *testing.T) {
	for _, whole := range []bool{false} {
		for i, tc := range []struct {
			member string
			code   int32
		}{
			{"helper = Missing", 2304},
			{"helper: number = \"bad\"", 2322},
			{"helper = ({}).missing", 2339},
			{"helper = ((n: number) => n)(\"bad\")", 2345},
			{"helper: Missing = 1", 2304},
			{"helper(): number { return Missing }", 2304},
			{"get helper(): number { return Missing }", 2304},
			{"helper(): number!! { return 1 }", 2322},
			{"helper = class { nested }", 7008},
			{"helper = class { nested(): void }", 2391},
			{"helper = class { static nested!: number }", 1255},
		} {
			t.Run(fmt.Sprintf("whole%v/member%d", whole, i), func(t *testing.T) {
				head, shape := "export service S", "n: number;"
				if whole {
					head, shape = head+": { n: number }", ""
				}
				source := head + " { static readonly key = \"native/S\"; " + shape + tc.member + " }"
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
				if len(got) != want || got[902] != 1 || tc.code != 0 && got[tc.code] != 1 {
					t.Fatalf("want one EK0902 and independent TS%d, got %v: %s", tc.code, got, source)
				}
			})
		}
	}
}
