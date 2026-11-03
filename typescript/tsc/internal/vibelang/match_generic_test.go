package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestGenericMatchCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"literal-incomplete", `function f<T extends "A" | "B">(s:T){return match(s){when "A":1;}}`, true},
		{"literal-complete", `function f<T extends "A" | "B">(s:T){return match(s){when "A":1;when "B":2;}}`, false},
		{"literal-chain", `function f<U extends "A" | "B", T extends U>(s:T){return match(s){when "A":1;}}`, true},
		{"number-incomplete", `function f<T extends 1 | 2>(s:T){return match(s){when 1:1;}}`, true},
		{"boolean-incomplete", `function f<T extends boolean>(s:T){return match(s){when true:1;}}`, true},
		{"tag-incomplete", `function f<T extends {_tag:"A"} | {_tag:"B"}>(s:T){return match(s){when {_tag:"A"}:1;}}`, true},
		{"tag-complete", `function f<T extends {_tag:"A"} | {_tag:"B"}>(s:T){return match(s){when {_tag:"A"}:1;when {_tag:"B"}:2;}}`, false},
		{"bare-guard", `function f<T extends {_tag:"A"} | {_tag:"B"}>(s:T){if(s._tag==="A") return match(s){when {_tag:"A"}:1;};return 0;}`, true},
		{"refined-intersection", `function isA<T extends {_tag:"A"} | {_tag:"B"}>(s:T):s is T & {_tag:"A"} {return s._tag==="A"}; function f<T extends {_tag:"A"} | {_tag:"B"}>(s:T){if(isA(s)) return match(s){when {_tag:"A"}:1;};return 0;}`, false},
		{"default", `function f<T extends "A" | "B">(s:T){return match(s){when "A":1;default:0;}}`, false},
		{"guarded", `function f<T extends "A" | "B">(s:T, flag:boolean){return match(s){when "A" and if(flag):1;when "B":2;}}`, true},
		{"binding", `function f<T extends "A" | "B">(s:T){return match(s){when "A":1;when let other:2;}}`, false},
		{"open", `function f<T>(s:T){return match(s){when "A":1;}}`, false},
		{"broad", `function f<T extends string>(s:T){return match(s){when "A":1;}}`, false},
		{"literal-singleton", `function f(){return match(0){when 0:1;}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			got := false
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Code() == 4701 {
					got = true
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s", d.String())
				}
			}
			if got != tc.missing {
				t.Errorf("EK4701=%t, want %t", got, tc.missing)
			}
		})
	}
}
