package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestPrimitiveWrapperTagCoverage(t *testing.T) {
	for _, tc := range []struct{ name, typ, literals, prefix string }{
		{"String", `"a"|"b"`, `when "a":2;when "b":3;`, ""},
		{"Number", "1|2", `when 1:2;when 2:3;`, ""},
		{"Boolean", "boolean", `when true:2;when false:3;`, ""},
		{"BigInt", "1n|2n", `when 1n:2;when 2n:3;`, ""},
		{"Symbol", "typeof A|typeof B", `when A:2;when B:3;`, "declare const A:unique symbol;declare const B:unique symbol;"},
	} {
		for _, shape := range []string{"missing", "complete", "default", "generic", "boxed"} {
			t.Run(tc.name+"/"+shape, func(t *testing.T) {
				prefix := fmt.Sprintf("export {};declare global {interface %s{readonly _tag:\"Only\"}};", tc.name) + tc.prefix
				typ := tc.typ + `|{_tag:"Only"}`
				params, tail := "", ""
				want := 1
				switch shape {
				case "complete":
					tail = tc.literals
					want = 0
				case "default":
					tail = "default:0;"
					want = 0
				case "generic":
					params = "<T extends " + typ + ">"
					typ = "T"
				case "boxed":
					typ = tc.name
					want = 0
				}
				source := prefix + fmt.Sprintf("export function f%s(s:%s){return match(s){when {_tag:\"Only\"}:1;%s}}", params, typ, tail)
				p, f, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() == EK4701.Code {
						count++
					} else {
						t.Error(d.String())
					}
				}
				if count != want {
					t.Errorf("got %d EK4701, want %d\n%s", count, want, source)
				}
			})
		}
	}
}
