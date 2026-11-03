package vibelang

import (
	"context"
	"testing"
)

func TestMatchTaggedMemberCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"shared", "type S={_tag:\"A\";x:number}|{_tag:\"A\";y:number};function f(s:S){return match(s){when {_tag:\"A\"}:1;}}", false},
		{"union", "function f(s:{_tag:\"A\"|\"B\"}|{_tag:\"C\"}){return match(s){when {_tag:\"A\"}:1;when {_tag:\"B\"}:2;when {_tag:\"C\"}:3;}}", false},
		{"number", "function f(s:{_tag:1|2}){return match(s){when {_tag:1}:1;when {_tag:2}:2;}}", false},
		{"bigint", "function f(s:{_tag:1n|2n}){return match(s){when {_tag:1n}:1;when {_tag:2n}:2;}}", false},
		{"boolean", "function f(s:{_tag:boolean}){return match(s){when {_tag:true}:1;when {_tag:false}:2;}}", false},
		{"enum", "enum E{A,B};function f(s:{_tag:E}){return match(s){when {_tag:E.A}:1;when {_tag:E.B}:2;}}", false},
		{"undefined", "function f(s:{_tag:undefined}){return match(s){when {_tag:undefined}:0;}}", false},
		{"required-payload", "type S={_tag:\"A\";x:number}|{_tag:\"A\";y:number};function f(s:S){return match(s){when {_tag:\"A\",let x}:x;when {_tag:\"A\",let y}:y;}}", false},
		{"missing-tag", "function f(s:{_tag:\"A\"|\"B\"}){return match(s){when {_tag:\"A\"}:1;}}", true},
		{"missing-payload", "type S={_tag:\"A\";x:number}|{_tag:\"A\";y:number};function f(s:S){return match(s){when {_tag:\"A\",let x}:x;}}", true},
		{"optional-tag", "function f(s:{_tag?:\"A\"}){return match(s){when {_tag:\"A\"}:1;when {_tag:undefined}:0;}}", true},
		{"optional-payload", "function f(s:{_tag:\"A\";x?:number}){return match(s){when {_tag:\"A\",let x}:1;}}", true},
		{"guarded", "function f(s:{_tag:\"A\"}){return match(s){when {_tag:\"A\"} and if (false):1;}}", true},
		{"member-value-string-union", "function f(s:{_tag:\"A\"|\"B\"},v:\"A\"|\"B\"){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-string-singleton", "function f(s:{_tag:\"A\"},v:\"A\"|\"B\"){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-number-union", "function f(s:{_tag:1|2},v:1|2){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-number-singleton", "function f(s:{_tag:1},v:1|2){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-boolean-union", "function f(s:{_tag:boolean},v:boolean){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-boolean-singleton", "function f(s:{_tag:true},v:boolean){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-bigint-union", "function f(s:{_tag:1n|2n},v:1n|2n){return match(s){when {_tag:v}:0;}}", true},
		{"member-value-enum-union", "enum E{A,B};function f(s:{_tag:E},v:E){return match(s){when {_tag:v}:0;}}", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			missing := false
			for _, d := range program.GetSemanticDiagnostics(context.Background(), file) {
				if d.Code() == EK4701.Code {
					missing = true
				} else {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if missing != tc.missing {
				t.Errorf("EK4701 = %v, want %v", missing, tc.missing)
			}
		})
	}
}
