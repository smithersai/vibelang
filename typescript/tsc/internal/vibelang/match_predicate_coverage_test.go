package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-7: user matchers narrow source reads, but cover no finite case.
func TestPredicatePatternCoverage(t *testing.T) {
	const one = "function isOne(s:unknown):s is 1{return s===1};"
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"literal", one + "function f(s:1|2){return match(s){when isOne:1;when 2:2;}}", true},
		{"alias", one + "const test=isOne;function f(s:1|2){return match(s){when test:1;when 2:2;}}", true},
		{"property", one + "const tests={one:isOne};function f(s:1|2){return match(s){when tests.one:1;when 2:2;}}", true},
		{"or", one + "function f(s:1|2){return match(s){when isOne or 2:1;}}", true},
		{"whole-domain", "function all(s:unknown):s is 1|2{return s===1||s===2};function f(s:1|2){return match(s){when all:1;}}", true},
		{"two-predicates", one + "function isTwo(s:unknown):s is 2{return s===2};function f(s:1|2){return match(s){when isOne:1;when isTwo:2;}}", true},
		{"boolean", "function yes(s:unknown):s is true{return s===true};function f(s:boolean){return match(s){when yes:1;when false:0;}}", true},
		{"string", "function isA(s:unknown):s is \"A\"{return s===\"A\"};function f(s:\"A\"|\"B\"){return match(s){when isA:1;when \"B\":2;}}", true},
		{"tagged", "function isA(s:unknown):s is {_tag:\"A\"}{return false};function f(s:{_tag:\"A\"}|{_tag:\"B\"}){return match(s){when isA:1;when {_tag:\"B\"}:2;}}", true},
		{"nested-tag", "function isA(s:unknown):s is \"A\"{return s===\"A\"};function f(s:{_tag:\"A\"}|{_tag:\"B\"}){return match(s){when {_tag:isA}:1;when {_tag:\"B\"}:2;}}", true},
		{"generic", one + "function f<T extends 1|2>(s:T){return match(s){when isOne:1;when 2:2;}}", true},
		{"explicit-cases", one + "function f(s:1|2){return match(s){when 1:1;when isOne:1;when 2:2;}}", false},
		{"binding", one + "function f(s:1|2){return match(s){when isOne:1;when let rest:rest;}}", false},
		{"default-flow", one + "function f(s:1|2){return match(s){when isOne:do{const a:1=s;a};default:do{const b:2=s;b};}}", false},
		{"is-flow", one + "function f(s:1|2){if(s is isOne){const a:1=s;return a}else{const b:2=s;return b}}", false},
		{"open", one + "function f(s:number){return match(s){when isOne:1;}}", false},
		{"primitive-value", "const one=1;function f(s:1|2){return match(s){when one:1;when 2:2;}}", false},
		{"fixed", "function f(s:Option.Option<number>){return match(s){when Option.Some(let n):n;when Option.None:0;}}", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == EK4701.Code {
					count++
				} else {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			want := 0
			if tc.missing {
				want = 1
			}
			if count != want {
				t.Errorf("EK4701 count %d, want %d\n%s", count, want, tc.source)
			}
		})
	}
}
