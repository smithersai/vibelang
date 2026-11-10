package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGlobalThisEscapeNativeErrors(t *testing.T) {
	for _, tc := range []struct {
		key, source string
		native      int32
	}{
		{"missing-key", "export const value = globalThis[Missing];", 2304},
		{"arity", "export const value = globalThis[((n:number)=>n)()];", 2554},
		{"callability", "export const value = globalThis[(1)()];", 2349},
		{"argument-type", "export const value = globalThis[((n:number)=>n)(\"bad\")];", 2345},
		{"assertion-type", "export const value = (globalThis as Missing);", 2304},
		{"satisfies", "export const value = (globalThis satisfies number);", 1360},
		{"key-type", "export const value = globalThis[(1 as Missing)];", 2304},
		{"nested-index", "declare const key:string; declare const empty:{}; export const value = globalThis[empty[key]];", 7053},
		{"undefined-index", "declare const key:string; export const value = globalThis[({})[key]];", 2538},
		{"ordinary-key", "declare const key:string; export const value = globalThis[key];", 0},
		{"numeric-key", "export const value = globalThis[0];", 0},
		{"alias", "export const value = globalThis;", 0},
	} {
		t.Run(tc.key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
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
			if len(got) != want || got[107] != 1 || tc.native != 0 && got[tc.native] != 1 {
				t.Fatalf("want EK0107 and independent TS%d, got %v: %s", tc.native, got, tc.source)
			}
		})
	}
}
