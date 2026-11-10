package vibelangfuzz

import "testing"

// Appendix A inherits TypeScript class heritage. parseExpressionWithTypeArguments
// reads the type arguments without the no-LineTerminator guard used by a type
// reference. Stock TypeScript 5.9.3 accepts every form here with only missing-name
// diagnostics; malformed lists and a type reference across a line break still fail.
var grammarHeritageLineBreakForms = []string{
	"class C extends B\n<T> {}",
	"class C extends B\r\n<T> {}",
	"class C extends B /*\n*/ <T> {}",
	"class C extends f(\"C\")\n<{}> {}",
	"class C extends f(\"C\")\n<T> implements I {}",
	"const C = class extends f(\"C\")\n<{}> {};",
	"export class C extends ns.B\n<T> {}",
	"class C extends (B)\n<T> {}",
	"class C extends B\n<T, U> {}",
}

var grammarHeritageLineBreakRejected = []string{
	"class C extends B\n<> {}",
	"class C extends B\n<,> {}",
	"class C extends B\n<T,,> {}",
	"type X = B\n<T>;",
}

func TestGrammarAdmissionHeritageLineBreak(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarHeritageLineBreakForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("class heritage across a line break has no derivation: %q", source)
		}
		if r := lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
			t.Errorf("class heritage across a line break has no TypeScript derivation: %q", source)
		}
	}
	for _, source := range grammarHeritageLineBreakRejected {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed heritage or type reference has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionHeritageLineBreakRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(append([]string{}, grammarHeritageLineBreakForms...), grammarHeritageLineBreakRejected...) {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("native class heritage reads as an admission gap: %q", source)
		}
	}
}
