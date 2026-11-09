package vibelangfuzz

import (
	"fmt"
	"testing"
)

const grammarCallbackTrailingEffectWitness = "effect function withAnyResource < E , R > ( open : ( ) => Disposable ! E ! ) {\nusing r = try open ( )\nreturn \"used\"\n}"

func TestGrammarAdmissionCallbackEffectQuoted(t *testing.T) {
	TestGrammarAdmissionParenthesizedEffectQuoted(t)
}

func grammarCallbackTrailingTypes() []string {
	out := []string{grammarCallbackTrailingEffectWitness}
	for _, typ := range []string{"A!E!", "(A | B)!E!", "A!(E | F)!"} {
		for _, form := range []string{
			"function f(open: () => %s) { }",
			"function f(open: () => %s, n: number) { }",
			"function f(open: () => %s = value) { }",
			"function f(value: %s) { }",
			"class C { m(open: () => %s) { } }",
			"type F = (open: () => %s) => void;",
			"const f = (open: () => %s) => 1;",
			"const value = (x as %s);",
		} {
			out = append(out, fmt.Sprintf(form, typ))
		}
	}
	return out
}

func TestGrammarAdmissionCallbackEffectKeys(t *testing.T) {
	for _, source := range grammarCallbackTrailingTypes() {
		if got := grammarAdmissionForm(source); got != "admission:effect-type-trailing-bang" {
			t.Errorf("callback final slot lost its pending key: key=%q source=%q", got, source)
		}
	}
	for _, source := range []string{
		"function f(open: () => A!E) { }",
		"function f(open: () => A!!) { }",
		"function f(open: () => A!E!R) { }",
		"function f(open: () => (A!!)!E) { }",
		"const value = (a! + b!);",
		"f(a!, b!);",
		"type T = (A!B | C!);",
		"function f(open: () => A!E!) { const b = x is 1 + 1; }",
	} {
		if grammarParenthesizedEffectTrailingBang(grammarLexSource(source)) {
			t.Errorf("valid type, non-null expression or independent gap was keyed: %q", source)
		}
	}
}

func TestGrammarAdmissionCallbackEffectRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarCallbackTrailingTypes() {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
