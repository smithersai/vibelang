package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"maps"
	"strings"
	"testing"
)

func TestServiceConstructorMethodSignatures(t *testing.T) {
	for _, tc := range []struct {
		name, member, usage string
		loose               bool
		want                map[int32]int
	}{
		{"plain", "constructor():number", "export const impl:S.Shape={constructor:()=>7}", false, nil},
		{"quoted", "\"constructor\"():number", "export const impl:S.Shape={constructor:()=>7}", false, nil},
		{"escaped", "c\\u006fnstructor():number", "export const impl:S.Shape={constructor:()=>7}", false, nil},
		{"generic", "constructor<T>(x:T):T", "export const impl:S.Shape={constructor:x=>x}", false, nil},
		{"overload", "constructor(x:number):number;constructor(x:string):string", "export const impl:S.Shape={constructor:<T extends number|string>(x:T):T=>x}", false, nil},
		{"missing-return", "constructor()", "", false, map[int32]int{7010: 1}},
		{"missing-return-loose", "constructor()", "", true, nil},
		{"missing-parameter-type", "constructor(x):number", "", false, map[int32]int{7006: 1}},
		{"missing-type", "constructor(x:Missing):number", "", false, map[int32]int{2304: 1}},
		{"wrong-value", "constructor():number", "export const impl:S.Shape={constructor:()=>\"wrong\"}", false, map[int32]int{2322: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export service S {static readonly key=\"constructor-method/S\";" + tc.member + "};" + tc.usage
			config := editorTsconfig
			if tc.loose {
				config = strings.Replace(config, "\"strict\":true", "\"strict\":true,\"noImplicitAny\":false", 1)
			}
			p, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
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

func TestServiceConstructorMethodControls(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         map[int32]int
	}{
		{"body", "export service S {static readonly key=\"constructor-method/S\";constructor() {}}", map[int32]int{902: 1}},
		{"parameter-property-body", "export service S {static readonly key=\"constructor-method/S\";constructor(public n:number) {}}", map[int32]int{902: 1}},
		{"whole-shape", "export service S:{} {static readonly key=\"constructor-method/S\";constructor():number}", map[int32]int{902: 1}},
		{"ordinary-class", "export class C {constructor(public n:number) {}}", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
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
