package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceReservedNativeErrors(t *testing.T) {
	for _, whole := range []bool{false, true} {
		for i, tc := range []struct {
			member string
			code   int32
		}{
			{"private static readonly key: Missing = \"native/S\"", 2304},
			{"protected static readonly key: number = \"native/S\"", 2322},
			{"static readonly key?: Missing = \"native/S\"", 2304},
			{"private static readonly defaultValue = Missing", 2304},
			{"static defaultValue: Missing = () => ({ n: 1 })", 2304},
			{"static readonly defaultValue? = () => ({ n: ({}).missing })", 2339},
			{"static defaultValue", 0},
			{"static readonly defaultValue!: () => { n: number }", 0},
			{"declare static readonly defaultValue = () => ({ n: 1 })", 0},
			{"declare static defaultValue = () => ({ n: 1 })", 0},
			{"declare static readonly defaultValue = () => ({ n: Missing })", 2304},
			{"declare static readonly defaultValue: () => { n: number } = () => ({ n: ({}).missing })", 2339},
		} {
			t.Run(fmt.Sprintf("whole%v/member%d", whole, i), func(t *testing.T) {
				head, shape, key := "export service S", "n: number;", "static readonly key = \"native/S\";"
				if whole {
					head, shape = head+": { n: number }", ""
				}
				if strings.Contains(tc.member, " key") {
					key = ""
				}
				source := head + " { " + key + shape + tc.member + " }"
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
