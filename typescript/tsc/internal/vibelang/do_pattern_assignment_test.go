package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestDoPatternDefiniteAssignment(t *testing.T) {
	for _, test := range []struct {
		name, condition string
		missing         bool
	}{
		{"binding-before-do", `(s is {field:let value}) && do {true}`, false},
		{"binding-after-do", `do {true} && (s is {field:let value})`, false},
		{"nested-and", `((s is {field:let value}) && do {true}) && true`, false},
		{"flag-result", `(s is {field:let value}) && do {flag}`, false},
		{"negated-or", `!(!(s is {field:let value}) || do {false})`, false},
		{"do-skips-binding", `do {true} || (s is {field:let value})`, true},
		{"binding-may-fail", `(s is {field:let value}) || do {true}`, true},
		{"source-skips-binding", `(flag || (s is {field:let value})) && do {true}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := fmt.Sprintf("export function f(s:{field:number}|null,flag:boolean){if(%s)return value;return 0}", test.condition)
			program, file, _, _ := editorProgram(t, source)
			missing := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 2454 {
					missing++
				} else {
					t.Error(d.String())
				}
			}
			want := 0
			if test.missing {
				want = 1
			}
			if missing != want {
				t.Errorf("got %d TS2454, want %d: %s", missing, want, source)
			}
		})
	}
}

func TestDoPatternAssignmentKeepsLaterNarrowing(t *testing.T) {
	for _, body := range []string{
		`if((s is {field:let value}) && do {true} && value===1 && do {true}) {const one:1=value;return one};return 0`,
		`if((s is {field:let value}) && do {true}) {value=3;const three:3=value;return three};return 0`,
	} {
		source := "export function f(s:{field:1|3}|null){" + body + "}"
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("later flow was lost: %v\n%s", ds, source)
		}
	}
}
