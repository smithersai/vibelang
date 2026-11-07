package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestComputedKeyMatchCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, prefix, domain, parameters, arms string
		missing                                bool
	}{
		{"literal", "", `{_tag:"A"|"B"}`, "", `when {["_tag"]:"A"}:1;when {["_tag"]:"B"}:2;`, false},
		{"generic", "", `{_tag:"A"|"B"}`, "generic", `when {["_tag"]:"A"}:1;when {["_tag"]:"B"}:2;`, false},
		{"parameter", "", `{_tag:"A"|"B"}`, `,key:"_tag"`, `when {[key]:"A"}:1;when {[key]:"B"}:2;`, false},
		{"constant", `const key="_tag" as const;`, `{_tag:"A"|"B"}`, "", `when {[key]:"A"}:1;when {[key]:"B"}:2;`, false},
		{"getter", `const Key={get field():"_tag"{return "_tag"}};`, `{_tag:"A"|"B"}`, "generic", `when {[Key.field]:"A"}:1;when {[Key.field]:"B"}:2;`, false},
		{"required", "", `{_tag:"A";x:number}|{_tag:"B";x:number}`, "generic", `when {["_tag"]:"A",["x"]:let x}:x;when {["_tag"]:"B",["x"]:let x}:x;`, false},
		{"number", "", `{_tag:"A";1:number}|{_tag:"B";1:number}`, "generic", `when {["_tag"]:"A",[1]:let x}:x;when {["_tag"]:"B",[1]:let x}:x;`, false},
		{"symbol", `declare const key:unique symbol;`, `{_tag:"A";[key]:number}|{_tag:"B";[key]:number}`, "generic", `when {["_tag"]:"A",[key]:let x}:x;when {["_tag"]:"B",[key]:let x}:x;`, false},
		{"optional", "", `{_tag:"A";x?:number}|{_tag:"B";x?:number}`, "generic", `when {["_tag"]:"A",["x"]:let x}:1;when {["_tag"]:"B",["x"]:let x}:2;`, true},
		{"guard", "", `{_tag:"A"|"B"}`, "generic", `when {["_tag"]:"A"} and if(flag):1;when {["_tag"]:"B"}:2;`, true},
		{"refutable", "", `{_tag:"A";x:number}|{_tag:"B";x:number}`, "generic", `when {["_tag"]:"A",["x"]:1}:1;when {["_tag"]:"B",["x"]:1}:2;`, true},
		{"missing", "", `{_tag:"A"|"B"}`, "generic", `when {["_tag"]:"A"}:1;`, true},
		{"union-key", "", `{_tag:"A"|"B";other:"A"|"B"}`, `,key:"_tag"|"other"`, `when {[key]:"A"}:1;when {[key]:"B"}:2;`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parameters, domain, extra := "", tc.domain, tc.parameters
			if extra == "generic" {
				parameters = "<T extends " + domain + ">"
				domain = "T"
				extra = ""
			}
			source := tc.prefix + fmt.Sprintf("export function f%s(s:%s,flag:boolean%s){return match(s){%s}}", parameters, domain, extra, tc.arms)
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
			want := 0
			if tc.missing {
				want = 1
			}
			if count != want {
				t.Errorf("got %d EK4701, want %d\n%s", count, want, source)
			}
		})
	}
}
