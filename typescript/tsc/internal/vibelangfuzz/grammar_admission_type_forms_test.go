package vibelangfuzz

import "testing"

// TypeScript type forms the lab's subset did not derive: variance modifiers
// on a type parameter and template literal types. TypeScript's parser reads
// `in` and `out` on any type parameter and its checker rejects them outside
// a class, interface or type alias (TS1274), as it does a misplaced `const`
// (TS1277), so the lab reads them the same way and the oracle counts the
// checker's rejection.
var grammarTypeForms = []string{
	"class C<in out T> { }",
	"class C<in T, out U, const V> { }",
	"interface I<in T, out U> { }",
	"type T<in out U> = U;",
	"data D<in T> { A }",
	"type T = `a`;",
	"type T = `a${string}b${number}c`;",
	"const x: `a${string}` = y;",
	"function g(): `a${string}` { return y }",
	"const x = y as `a${string}`;",
	"schema S = `a`;",
	"error E { a: `x${string}` }",
	"type T = `a${string}`!E;",
	"type T = A!`e`;",
}

func TestGrammarAdmissionTypeForms(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range grammarTypeForms {
		if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count == 0 {
			t.Errorf("type form has no derivation: %q", source)
		}
	}
	for _, source := range []string{
		"class C<in> { }",
		"class C<T in> { }",
		"type T = `a` `b`;",
		"type T = `a`.b;",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 0 {
			t.Errorf("malformed type form has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionTypeFormsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append([]string{
		// TypeScript rejects a variance modifier on a function's type parameter.
		"function g<in T>() { }",
		"effect function g<out T>() { }",
		// Generic services and errors meet their own static rules.
		"service S<in T> { }",
		"error E<out T> { }",
	}, grammarTypeForms...) {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("an inherited type form reads as an admission gap: %q", source)
		}
	}
}
