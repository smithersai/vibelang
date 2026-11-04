package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestDataOwnedMemberDiagnostics(t *testing.T) {
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
		{"data-method", "data D { A { m():void } }", "EK1606"},
		{"data-index", "data D { A { [key:string]:unknown } }", "EK1606"},
		{"data-call", "data D { A { (n:number):string } }", "EK1606"},
		{"data-untyped", "data D { A { n } }", "EK1606"},
		{"data-parenthesized", "data D { A(n:number) }", "EK1606"},
		{"data-parenthesized-function", "data D { A(f:(n:number)=>void) }", "EK1606"},
		{"data-generic-parenthesized", "data D<T> { A(n:T) }", "EK1606"},
		{"data-parenthesized-recovery", "data D { A(n:number); B }; const b:D=D.B()", "EK1606"},
		{"schema-fields", "schema S { n:number; readonly name?:string }", ""},
		{"data-fields", "data D { A { n:number; readonly name?:string }; B }; const d:D=D.A({n:1})", ""},
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
