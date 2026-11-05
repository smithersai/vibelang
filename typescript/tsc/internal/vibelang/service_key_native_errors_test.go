package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceKeyNativeErrors(t *testing.T) {
	for _, shape := range []string{"", ": number"} {
		for i, row := range []struct {
			member string
			code   int32
		}{
			{"static readonly key = Missing", 2304},
			{"static key: Missing = \"native/S\"", 2304},
			{"static readonly key: string = 7", 2322},
			{"static readonly key = ({}).missing", 2339},
			{"static readonly key = ((n: number) => n)(\"bad\")", 2345},
			{"static readonly key = 7 as Missing", 2304},
			{"private static readonly key = Missing", 2304},
			{"protected static readonly key: string = 7", 2322},
		} {
			t.Run(fmt.Sprintf("%s/%d", shape, i), func(t *testing.T) {
				source := "export service S" + shape + " { " + row.member + " }"
				p, file, _, _ := editorProgram(t, source)
				got := map[int32]int{}
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						got[d.Code()]++
					}
				}
				if len(got) != 2 || got[901] != 1 || got[row.code] != 1 {
					t.Fatalf("want EK0901 and independent TS%d, got %v: %s", row.code, got, source)
				}
			})
		}
	}
}
