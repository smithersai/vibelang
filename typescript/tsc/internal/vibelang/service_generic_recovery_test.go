package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceGenericWithRejectedMembers(t *testing.T) {
	for _, shape := range []string{"", ": Shape", ": number"} {
		for _, member := range []string{
			"[x: string]: unknown", "constructor() {}", "(): number", "new(): number",
			"get n() { return 1 }", "read() { return 1 }",
		} {
			for _, mutable := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/mutable=%t", shape, member, mutable), func(t *testing.T) {
					key := "static readonly key = \"generic/S\""
					if mutable {
						key = "static key = \"generic/S\""
					}
					source := "type Shape = number; export service S<T>" + shape + " { " + key + "; " + member + " }"
					p, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() != diagnosticSource {
							t.Errorf("unexpected native diagnostic: %s", d.String())
						}
						got[d.Code()]++
					}
					wantKey, wantKinds := 0, 2
					if mutable {
						wantKey, wantKinds = 1, 3
					}
					if got[3005] != 1 || got[902] != 1 || got[901] != wantKey || len(got) != wantKinds {
						t.Fatalf("want EK3005, EK0902 and %d EK0901, got %v: %s", wantKey, got, source)
					}
				})
			}
		}
	}
}

func TestServiceGenericRecoveryControls(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         map[int32]int
	}{
		{"native-generic", "export class Native<T> { static key = 7; constructor(public n: number) {}; get value() { return this.n } }", map[int32]int{}},
		{"concrete-service", "export service S { static readonly key = \"generic/S\"; n: number }", map[int32]int{}},
		{"generic-service", "export service S<T> { static readonly key = \"generic/S\"; n: number }", map[int32]int{3005: 1}},
		{"concrete-rejected", "export service S { static readonly key = \"generic/S\"; constructor() {} }", map[int32]int{902: 1}},
		{"independent-error", "export service S<T> { static readonly key = \"generic/S\"; constructor() {} }; export const invalid: number = \"wrong\"", map[int32]int{3005: 1, 902: 1, 2322: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			got := map[int32]int{}
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
				}
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for code, count := range tc.want {
				if got[code] != count {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}
