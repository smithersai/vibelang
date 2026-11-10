package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceStaticNativeErrors(t *testing.T) {
	for _, whole := range []bool{false, true} {
		for i, tc := range []struct {
			member string
			code   int32
		}{
			{"static helper = Missing", 2304},
			{"static helper: number = \"bad\"", 2322},
			{"static helper = ({}).missing", 2339},
			{"static helper = ((n: number) => n)(\"bad\")", 2345},
			{"static helper: Missing = 1", 2304},
			{"static helper(): number { return Missing }", 2304},
			{"static get helper(): number { return Missing }", 2304},
			{"static helper = class { nested }", 7008},
			{"static helper = class { nested(): void }", 2391},
			{"static helper = class { static nested!: number }", 1255},
			{"static helper", 0},
			{"static helper(): void", 0},
			{"static helper!: number", 0},
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
