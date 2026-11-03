package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestDataVariantMemberAdmission(t *testing.T) {
	for _, tc := range []struct{ name, source, code string }{
		{"parenthesized", "data D { A(x:number) }", "EK1606"},
		{"unclosed-recovery", "data D { A(x:number } data E { B }; const b:E=E.B()", "EK1606"},
		{"function-parameter", "data D { A(f:(n:number)=>void) }", "EK1606"},
		{"generic", "data D<T> { A(x:T) }", "EK1606"},
		{"recovery", "data D { A(x:number); B }; const b:D=D.B()", "EK1606"},
		{"newline-recovery", "data D { A(x:number)\nB }; const b:D=D.B()", "EK1606"},
		{"method", "data D { A { m():void } }", "EK1606"},
		{"generic-method", "data D<T> { A { m(x:T):T } }", "EK1606"},
		{"call", "data D { A { (x:number):string } }", "EK1606"},
		{"construct", "data D { A { new(x:number):object } }", "EK1606"},
		{"index", "data D { A { [key:string]:unknown } }", "EK1606"},
		{"getter", "data D { A { get n():number } }", "EK1606"},
		{"setter", "data D { A { set n(v:number) } }", "EK1606"},
		{"untyped", "data D { A { n } }", "EK1606"},
		{"fields", "data D { A { n:number; readonly name?:string }; B }; const d:D=D.A({n:1})", ""},
		{"newline-body", "data D { A\n{ n:number }; B }; const d:D=D.A({n:1})", ""},
		{"function-field", "data D { A { f:(n:number)=>void } }", ""},
		{"nested-native-method", "data D { A { inner:{ m():void } } }", ""},
		{"native-members", "interface I { m():void; (n:number):string; new(n:number):object }", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []string
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				source := d.Source()
				if source == "" {
					source = "TS"
				}
				got = append(got, fmt.Sprintf("%s%04d", source, d.Code()))
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
