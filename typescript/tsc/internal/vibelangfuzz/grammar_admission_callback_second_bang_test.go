package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarCallbackSecondBangWitness = "effect function withAnyResource < E , R > ( open : ( ) => Disposable ! E\n! 1 ) {\nusing r = try open ( )\nreturn \"used\"\n}"

var grammarCallbackSecondBangSources = []string{
	"function f(open: () => number!string\n!boolean) {}",
	"effect function f(open: () => number!string\n!boolean) {}",
	"const f = (open: () => number!string\n!boolean) => 0;",
	"class C { f(open: () => number!string\n!boolean) {} }",
	"class C { constructor(open: () => number!string\n!boolean) {} }",
	"declare function f(open: () => number!string\n!boolean): void;",
	"interface I { f(open: () => number!string\n!boolean): void }",
	"const f = null as unknown as (open: () => number!string\n!boolean) => void;",
	"function f(open: () => (number!string\n!boolean)) {}",
	"function f(open: () => number!(string | boolean)\n!1) {}",
	"function f(open: () => number!string /* newline */\r\n!boolean) {}",
	grammarCallbackSecondBangWitness,
}

var grammarCallbackSecondBangControls = []string{
	"function f(open: () => number!string!boolean) {}",
	"function f(open: () => number!string) {}",
	"function f(open: () => number!!) {}",
	"function f(open: () => number!(string!boolean)) {}",
	"function f(open: () => number!string) {}\n!boolean;",
	"const x = (a! + b!);",
	"const x = (a!\n!b);",
	"type T = (number!string); const x = (a!\n!b);",
	"function f(x = a!b\n!c) {}",
	"class C { a!: T\nb!: U }",
	"const s = 'function f(open: () => number!string !boolean) {}';",
}

func TestGrammarAdmissionCallbackSecondBangQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarParenthesizedEffectQuote) {
		t.Fatal("EffectType line-terminator production changed")
	}
}

func TestGrammarAdmissionCallbackSecondBangKeys(t *testing.T) {
	for _, source := range grammarCallbackSecondBangSources {
		if got := grammarAdmissionForm(source); got != "admission:effect-type-line-break" {
			t.Errorf("callback second bang lost line-break key: got %q: %s", got, source)
		}
	}
	for _, source := range grammarCallbackSecondBangControls {
		if grammarSecondBangLineBreak(grammarLexSource(source)) {
			t.Errorf("valid or independent syntax entered callback line-break family: %s", source)
		}
	}
	const independent = "function f(open: () => number!string\n!boolean) {} const b = x is 1 + 1;"
	if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
		t.Errorf("normalization hid an independent gap: %q", got)
	}
}

func TestGrammarAdmissionCallbackSecondBangRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarCallbackSecondBangSources {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("callback witness no longer exposes lost line-terminator rejection: %s", source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
