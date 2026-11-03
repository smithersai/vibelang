package vibelang

import (
	"context"
	"testing"
)

func TestMatchUnreachableCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"singleton-value", `function f(s:1|2,v:1){return 1;return match(s){when v:0;when 2:0;}}`, false},
		{"union-or-literal", `function f(s:1|2,v:1|2){return 1;return match(s){when v or 1:0;when 2:0;}}`, false},
		{"initializer", `data D{A;B{n:number}};effect function f(s:D){L:{return 1;}const n:number=match(s){when {_tag:"A"}:0;when {_tag:"B",let n}:n;};return n;}`, false},
		{"statement", `data D{A;B{n:number}};effect function f(s:D){L:{return 1;}match(s){when {_tag:"A"}:0;when {_tag:"B",let n}:n;}}`, false},
		{"guarded", `function f(s:boolean){L:{return 1;}return match(s){when true and if(s):1;when false:0;}}`, true},
		{"and", `function f(s:boolean){L:{return 1;}return match(s){when true and true:1;when false:0;}}`, true},
		{"not", `function f(s:boolean){L:{return 1;}return match(s){when not false:1;when false:0;}}`, true},
		{"literal-number-complete", "function f(s:1|2){L:{return 1;}return match(s){when 1:1;when 2:2;}}", false},
		{"literal-number-missing", "function f(s:1|2){L:{return 1;}return match(s){when 1:1;}}", true},
		{"literal-boolean-complete", "function f(s:boolean){L:{return 1;}return match(s){when true:1;when false:0;}}", false},
		{"literal-boolean-missing", "function f(s:boolean){L:{return 1;}return match(s){when true:1;}}", true},
		{"literal-nullish-complete", "function f(s:null|undefined){L:{return 1;}return match(s){when null:0;when undefined:1;}}", false},
		{"literal-nullish-missing", "function f(s:null|undefined){L:{return 1;}return match(s){when null:0;}}", true},
		{"literal-enum-complete", "enum E{A,B};function f(s:E){L:{return 1;}return match(s){when E.A:0;when E.B:1;}}", false},
		{"literal-enum-missing", "enum E{A,B};function f(s:E){L:{return 1;}return match(s){when E.A:0;}}", true},
		{"literal-error-complete", "error A;error B;function f(s:A|B){L:{return 1;}return match(s){when A:0;when B:1;}}", false},
		{"literal-error-missing", "error A;error B;function f(s:A|B){L:{return 1;}return match(s){when A:0;}}", true},
		{"literal-or-complete", "function f(s:1|2){L:{return 1;}return match(s){when 1 or 2:0;}}", false},
		{"literal-or-missing", "function f(s:1|2){L:{return 1;}return match(s){when 1:0;}}", true},
		{"literal-zero-complete", "function f(s:0){L:{return 1;}return match(s){when 0:0;}}", false},
		{"literal-zero-missing", "function f(s:0){L:{return 1;}return match(s){when -0:0;}}", true},
		{"plain-return", "data D{A;B{n:number}};function f(s:D){L:{return 1;}return match(s){when {_tag:\"A\"}:0;when {_tag:\"B\",let n}:n;}}", false},
		{"async-throw", "error Stop;data D{A;B{n:number}};async function f(s:D){L:{throw new Stop();}return match(s){when {_tag:\"A\"}:0;when {_tag:\"B\",let n}:n;}}", false},
		{"plain-missing", "data D{A;B{n:number}};function f(s:D){L:{return 1;}return match(s){when {_tag:\"B\",let n}:n;}}", true},
		{"effect-return", "data D{A;B{n:number}};export effect function f(s:D){L:{return 1;}return match(s){when {_tag:\"A\"}:0;when {_tag:\"B\",let n}:n;}}", false},
		{"effect-throw", "error Stop;data D{A;B{n:number}};export effect function f(s:D){L:{throw new Stop();}return match(s){when {_tag:\"A\"}:0;when {_tag:\"B\",let n}:n;}}", false},
		{"effect-missing", "data D{A;B{n:number}};export effect function f(s:D){L:{return 1;}return match(s){when {_tag:\"B\",let n}:n;}}", true},
		{"match-unreachable-value-number-union", "function f(s:1|2,v:1|2){L:{return 1;}return match(s){when v:0;}}", true},
		{"match-unreachable-value-number-singleton", "function f(s:1,v:1|2){L:{return 1;}return match(s){when v:0;}}", true},
		{"match-unreachable-value-boolean-union", "function f(s:boolean,v:boolean){L:{return 1;}return match(s){when v:0;}}", true},
		{"match-unreachable-value-boolean-singleton", "function f(s:true,v:boolean){L:{return 1;}return match(s){when v:0;}}", true},
		{"match-unreachable-value-nullish-union", "function f(s:null|undefined,v:null|undefined){L:{return 1;}return match(s){when v:0;}}", true},
		{"match-unreachable-value-enum-union", "enum E{A,B};function f(s:E,v:E){L:{return 1;}return match(s){when v:0;}}", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			missing := false
			for _, d := range p.GetSemanticDiagnostics(context.Background(), f) {
				if d.Code() == EK4701.Code {
					missing = true
				} else {
					t.Errorf("unexpected diagnostic %s", d.String())
				}
			}
			if missing != tc.missing {
				t.Errorf("EK4701=%v,want %v", missing, tc.missing)
			}
		})
	}
}
