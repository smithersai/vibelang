package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestGenericTaggedMemberCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, prefix, domain, arms string
		missing                    bool
	}{
		{"string", "", `{_tag:"A"|"B"}`, `when {_tag:"A"}:1;when {_tag:"B"}:2;`, false},
		{"number", "", `{_tag:1|2}`, `when {_tag:1}:1;when {_tag:2}:2;`, false},
		{"boolean", "", `{_tag:boolean}`, `when {_tag:true}:1;when {_tag:false}:2;`, false},
		{"bigint", "", `{_tag:1n|2n}`, `when {_tag:1n}:1;when {_tag:2n}:2;`, false},
		{"shared", "", `{_tag:"A";x:number}|{_tag:"A";y:number}`, `when {_tag:"A"}:1;`, false},
		{"required", "", `{_tag:"A"|"B";x:number}`, `when {_tag:"A",let x}:x;when {_tag:"B",let x}:x;`, false},
		{"or", "", `{_tag:"A"|"B"}`, `when {_tag:"A"} or {_tag:"B"}:1;`, false},
		{"capture", "", `{_tag:"A"|"B"}`, `when {_tag:"A"} and let a:1;when const b and {_tag:"B"}:2;`, false},
		{"mixed", "", `{_tag:"A"|"B"}|{_tag:"C"}`, `when {_tag:"A"}:1;when {_tag:"B"}:2;when {_tag:"C"}:3;`, false},
		{"enum", "enum E{A,B};", `{_tag:E}`, `when {_tag:E.A}:1;when {_tag:E.B}:2;`, false},
		{"missing", "", `{_tag:"A"|"B"}`, `when {_tag:"A"}:1;`, true},
		{"optional-payload", "", `{_tag:"A"|"B";x?:number}`, `when {_tag:"A",let x}:1;when {_tag:"B",let x}:2;`, true},
		{"optional-tag", "", `{_tag?:"A"}`, `when {_tag:"A"}:1;when {_tag:undefined}:2;`, true},
		{"guard", "", `{_tag:"A"|"B"}`, `when {_tag:"A"} and if(flag):1;when {_tag:"B"}:2;`, true},
		{"refutable", "", `{_tag:"A"|"B"}`, `when ({_tag:"A"} and {_tag:"A"}):1;when {_tag:"B"}:2;`, true},
		{"shared-missing", "", `{_tag:"A";x:number}|{_tag:"A";y:number}`, `when {_tag:"A",let x}:1;`, true},
	} {
		for _, parameters := range []string{"T extends " + tc.domain, "U extends " + tc.domain + ",T extends U"} {
			t.Run(tc.name+"/"+parameters, func(t *testing.T) {
				source := tc.prefix + fmt.Sprintf("export function f<%s>(s:T,flag:boolean){return match(s){%s}}", parameters, tc.arms)
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
					t.Errorf("EK4701 count=%d, want %d\n%s", count, want, source)
				}
			})
		}
	}
}
