package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorConstAliasArity(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		for _, alias := range []struct {
			name, setup, matcher, parameters string
			known                            bool
		}{
			{"direct", "", "E", "", true},
			{"const", "const Match=E;", "Match", "", true},
			{"typed", "const Match:typeof E=E;", "Match", "", true},
			{"chain", "const First=E;const Match=First;", "Match", "", true},
			{"parentheses", "const Match=((E));", "Match", "", true},
			{"assertion", "const Match=(E as typeof E);", "Match", "", true},
			{"mutable", "declare let Match:typeof E;", "Match", "", false},
			{"declared", "declare const Match:typeof E;", "Match", "", false},
			{"parameter", "", "Match", ",Match:typeof E", false},
		} {
			for _, shape := range []struct {
				args  string
				wrong bool
			}{
				{"", true}, {"let item", false}, {"let first,let second", true},
			} {
				t.Run(kind+"/"+alias.name+"/"+shape.args, func(t *testing.T) {
					source := kind + " E{code:number};" + alias.setup + fmt.Sprintf("export function f(subject:unknown%s){return match(subject){when %s(%s):1;default:0;}}", alias.parameters, alias.matcher, shape.args)
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Code() == EK0703.Code {
							count++
							if d.Category() != diagnostics.CategoryWarning {
								t.Errorf("arity is not a warning: %s", d.String())
							}
						} else if d.Category() == diagnostics.CategoryError {
							t.Error(d.String())
						}
					}
					want := 0
					if alias.known && shape.wrong {
						want = 1
					}
					if count != want {
						t.Errorf("got %d EK0703, want %d\n%s", count, want, source)
					}
				})
			}
		}
	}
}
