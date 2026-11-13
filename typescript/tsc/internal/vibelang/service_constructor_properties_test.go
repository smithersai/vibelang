package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"maps"
	"testing"
)

func TestServiceConstructorProperties(t *testing.T) {
	for _, tc := range []struct {
		name, member, usage string
		want                map[int32]int
	}{
		{"plain", "constructor: string", "export const impl:S.Shape={constructor:\"ok\"}", nil},
		{"readonly", "readonly constructor: string", "export const impl:S.Shape={constructor:\"ok\"}; impl.constructor=\"no\"", map[int32]int{2540: 1}},
		{"optional", "constructor?: string", "export const impl:S.Shape={constructor:undefined}", nil},
		{"function-property", "constructor: () => number", "export const impl:S.Shape={constructor:()=>7}", nil},
		{"quoted", "\"constructor\": string", "export const impl:S.Shape={constructor:\"ok\"}", nil},
		{"quoted-optional", "\"constructor\"?: string", "export const impl:S.Shape={constructor:undefined}", nil},
		{"escaped", "c\\u006fnstructor: string", "export const impl:S.Shape={constructor:\"ok\"}", nil},
		{"optional-native-inherited", "constructor?: string", "export const impl:S.Shape={}", map[int32]int{2322: 1}},
		{"optional-method", "constructor?(): number", "export const impl:S.Shape={constructor:()=>7}", nil},
		{"quoted-optional-method", "\"constructor\"?(): number", "export const impl:S.Shape={constructor:()=>7}", nil},
		{"wrong-value", "constructor: string", "export const impl:S.Shape={constructor:7}", map[int32]int{2322: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export service S { static readonly key=\"constructor-property/S\"; " + tc.member + " }; " + tc.usage
			p, file, _, _ := editorProgram(t, source)
			got := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
					t.Log(d.String())
				}
			}
			if !maps.Equal(got, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}
func TestServiceConstructorPropertyControls(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"actual-constructor", "service S { static readonly key=\"constructor-property/S\"; constructor() {} }", 902},
		{"native-class", "class C { constructor: string }", 1005},
		{"native-quoted-class", "class C { \"constructor\": string = \"value\" }", 18006},
		{"whole-shape", "service S: {} { static readonly key=\"constructor-property/S\"; constructor: string }", 902},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source+";export {}")
			found := false
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == tc.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing diagnostic %d", tc.code)
			}
		})
	}
}
