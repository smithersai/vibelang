package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceRejectedSignatureNativeErrors(t *testing.T) {
	families := []struct {
		key     string
		members []string
		whole   bool
	}{
		{"call", []string{"(value: Missing): number", "(): Missing", "<T extends Missing>(value:T): T", "(): {value:Missing}", "(): number", "()", "(): { () }"}, false},
		{"construct", []string{"new(value: Missing): number", "new(): Missing", "new<T extends Missing>(value:T): T", "new(): {value:Missing}", "new(): number", "new()", "new(): { () }"}, false},
		{"constructor", []string{"constructor() { Missing }", "constructor(value:Missing) {}", "constructor() { ({}).missing }", "constructor() { ((n:number)=>n)(\"bad\") }", "constructor() {}"}, true},
		{"index", []string{"[key:string]: Missing", "[key:Missing]: number", "[key:string]: {value:Missing}", "static [key:string]: Missing", " [key:string]: number", "static [key:string]: { [key:string]: string; field:number }"}, true},
	}
	for _, family := range families {
		for _, whole := range []bool{false, true} {
			if whole && !family.whole {
				continue
			}
			for i, member := range family.members {
				t.Run(fmt.Sprintf("%s/%v/%d", family.key, whole, i), func(t *testing.T) {
					shape := ""
					if whole {
						shape = ": {value:number}"
					}
					source := fmt.Sprintf("export service S%s { static readonly key = \"native/S\"; %s }", shape, member)
					p, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					code := int32(2304)
					if family.key == "constructor" && i == 2 {
						code = 2339
					}
					if family.key == "constructor" && i == 3 {
						code = 2345
					}
					if i == 4 {
						code = 0
					}
					if family.key == "index" && i == 5 {
						code = 2411
					}
					if (family.key == "call" || family.key == "construct") && i == 5 {
						code = 0
					}
					if (family.key == "call" || family.key == "construct") && i == 6 {
						code = 7020
					}
					t.Logf("diagnostics %v", got)
					if got[2307] != 0 || got[902] != 1 || code != 0 && got[code] != 1 || code == 0 && len(got) != 1 {
						t.Fatalf("want EK0902 and TS%d, got %v: %s", code, got, source)
					}
				})
			}
		}
	}
}
