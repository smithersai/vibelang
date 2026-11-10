package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceStaticNativeNestedErrors(t *testing.T) {
	for _, whole := range []bool{false, true} {
		for _, tc := range []struct {
			key, member string
			code        int32
		}{
			{"getter-signature", "static get helper(): number", 0},
			{"setter-signature", "static set helper(value: number)", 0},
			{"definite-initializer", "static helper!: number = 1", 0},
			{"definite-untyped", "static helper!", 0},
			{"key-marker", "static readonly key!: string = \"native/S\"", 0},
			{"default-marker", "static readonly defaultValue!: () => { n: number } = () => ({ n: 1 })", 0},
			{"nested-property", "static helper(): void { class Inner { field } }", 7008},
			{"nested-overload", "static helper(): void { function inner(): void; }", 2391},
			{"nested-static-marker", "static helper = class Inner { static field!: number }", 1255},
			{"nested-initializer-marker", "static helper = class Inner { field!: number = 1 }", 1263},
			{"nested-accessor", "static helper(): void { class Inner { get value(): number; } }", 1005},
			{"modifier-order", "static private helper = 1", 0},
			{"override-static", "static override helper = 1", 0},
			{"nested-modifier-order", "static helper = class Inner { static private x = 1 }", 1029},
			{"default-nested-property", "static defaultValue = () => { class Inner { field }; return { n: 1 } }", 7008},
			{"default-nested-overload", "static defaultValue = () => { function inner(): void; return { n: 1 } }", 2391},
		} {
			t.Run(fmt.Sprintf("whole%v/%s", whole, tc.key), func(t *testing.T) {
				head, body, key := "export service S", "n: number;", "static readonly key = \"native/S\";"
				if whole {
					head, body = head+": { n: number }", ""
				}
				if tc.key == "key-marker" {
					key = ""
				}
				source := head + " { " + key + body + tc.member + " }"
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
