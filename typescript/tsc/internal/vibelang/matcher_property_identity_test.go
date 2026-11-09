package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestMatcherPropertyIdentity(t *testing.T) {
	for _, binding := range []struct {
		name, source string
		valid        bool
	}{
		{"unrelated-symbol", `const customMatcher=Symbol("other");`, false},
		{"string", `const customMatcher="customMatcher";`, false},
		{"number", `const customMatcher=17;`, false},
		{"other-well-known-symbol", `const customMatcher=Symbol.toStringTag;`, false},
		{"protocol-alias", `const customMatcher:typeof Symbol.customMatcher=Symbol.customMatcher;`, true},
	} {
		for _, form := range []string{"is", "arm", "extract"} {
			for _, home := range []string{"module", "local"} {
				t.Run(binding.name+"/"+form+"/"+home, func(t *testing.T) {
					setup := binding.source + `const Matcher={[customMatcher](s:unknown):number[]{return [1]}};`
					expr := "s is Matcher"
					if form == "arm" {
						expr = "match(s){when Matcher:1;default:0;}"
					}
					if form == "extract" {
						expr = "match(s){when Matcher(let x):x;default:0;}"
					}
					source := setup + "export function inspect(s:unknown){return " + expr + "}"
					if home == "local" {
						source = "export function inspect(s:unknown){" + setup + "return " + expr + "}"
					}
					p, f, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Source() == "EK" && d.Code() == 702 {
							count++
							continue
						}
						if d.Category() == diagnostics.CategoryError {
							t.Errorf("unexpected %s", d.String())
						}
					}
					want := 1
					if binding.valid {
						want = 0
					}
					if count != want {
						t.Errorf("want %d EK0702, got %d\n%s", want, count, source)
					}
				})
			}
		}
	}
	for _, source := range []string{
		`const customMatcher=Symbol("other");class Matcher{static [customMatcher](s:unknown){return [1]}};export function f(s:unknown){return s is Matcher}`,
		`const customMatcher="customMatcher";class Matcher{static [customMatcher](s:unknown){return [1]}};export function f(s:unknown){return s is Matcher}`,
	} {
		p, f, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("ordinary class control: %s", d.String())
			}
		}
	}
}
