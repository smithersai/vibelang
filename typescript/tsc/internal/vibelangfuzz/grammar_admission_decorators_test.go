package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarDecoratorQuote = "`DecoratorList` is TypeScript's class decorator list and is admitted only on class elements, with TypeScript placement checks; an object-literal method has none."

const grammarObjectProducerQuote = "PropertyName and Block in an object literal, with no DecoratorList or Modifiers there"

func TestGrammarAdmissionDecoratorsQuoted(t *testing.T) {
	text := SpecText(grammarAppendix)
	for _, quote := range []string{grammarAdmissionQuote, grammarDecoratorQuote, grammarObjectProducerQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Appendix A decorator authority changed: %s", quote)
		}
	}
}

var grammarDecoratorForms = []string{
	"const o = { effect *g() { yield 1; } };",
	"@dec class C { }",
	"@a @b class C { }",
	"@ns.dec class C { }",
	"@factory(1) class C { }",
	"@(x => x) class C { }",
	"@(obj[key]) class C { }",
	"@dec! class C { }",
	"@dec<number>() class C { }",
	"@dec abstract class C { }",
	"@dec export class C { }",
	"@dec export default class { }",
	"export @dec class C { }",
	"export default @dec class { }",
	"const C = @dec class { };",
	"class C { @dec m() { } }",
	"class C { @dec public m() { } }",
	"class C { @dec async m() { } }",
	"class C { @dec *g() { yield 1; } }",
	"class C { @dec get value() { return 1; } }",
	"class C { @dec set value(v: number) { } }",
	"class C { @dec accessor value = 1; }",
	"class C { @dec value: number = 1; }",
	"class C { @a @b static value = 1; }",
	"class C { @dec effect m() { return 1; } }",
	"class C { @dec public effect m() { return 1; } }",
	"class C { @dec effect *g() { yield 1; } }",
	"class C { @dec effect get value() { return 1; } }",
	"effect function f() { class C { @(try key()) effect m() { } } }",
	"effect function f() { class C { @(try key()) value = 1; } }",
	"error E { @dec m() { } }",
	"error E { @dec private m() { } }",
}

func TestGrammarAdmissionDecorators(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarDecoratorForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("inherited decorator form has no derivation: %q", source)
		}
	}
	for _, source := range []string{
		"@ class C { }",
		"@dec()() class C { }",
		"@obj[key] class C { }",
		"@obj?.dec class C { }",
		"@dec function f() { }",
		"const x = { @dec m() { } };",
		"const x = { @dec effect m() { } };",
		"const x = { @dec effect *g() { } };",
		"const x = { public effect *g() { } };",
		"const x = { effect *g(); };",
		"effect function f() { @fork class C { } }",
		"class C { @dec effect m() { const fork = 1; } }",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("invalid decorator form has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionDecoratorsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarDecoratorForms {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("inherited decorator form reads as an admission gap: %q", source)
		}
	}
}
