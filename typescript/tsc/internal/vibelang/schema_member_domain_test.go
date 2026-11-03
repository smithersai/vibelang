package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaMemberDomain(t *testing.T) {
	for _, tc := range []struct{ name, source, code string }{
		{"schema-method", "schema S { m():string }", "EK1505"},
		{"schema-index", "schema S { [key:string]:number }", "EK1505"},
		{"schema-call", "schema S { (n:number):string }", "EK1505"},
		{"schema-construct", "schema S { new (n:number):object }", "EK1505"},
		{"schema-getter", "schema S { get n():number }", "EK1505"},
		{"schema-setter", "schema S { set n(v:number) }", "EK1505"},
		{"schema-untyped", "schema S { n }", "EK1505"},
		{"schema-nested", "schema S { inner:{ m():void } }", "EK1505"},
		{"schema-readonly-nested", "schema S { readonly inner:{ m():void } }", "EK1505"},
		{"schema-alias-keeps-type-code", "schema S = { m():string }", "EK2109"},
		{"schema-fields", "schema S { n:number; readonly name?:string }", ""},
		{"native-members", "interface I { m():string; (n:number):string; new(n:number):object }", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []string
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					source := d.Source()
					if source == "" {
						source = "TS"
					}
					got = append(got, fmt.Sprintf("%s%04d", source, d.Code()))
				}
			}
			var want []string
			if tc.code != "" {
				want = []string{tc.code}
			}
			slices.Sort(got)
			if !slices.Equal(got, want) {
				t.Fatalf("codes %v, want %v", got, want)
			}
		})
	}
}
