package vibelangfuzz

import "testing"

// A computed member name is evaluated where its class or object literal is
// written, not inside the member it names: ECMAScript's ClassElementName and
// PropertyName carry the enclosing Yield and Await parameters, and Appendix
// A's Effect parameter follows them. In an effect function `[try k()]() { }`
// keeps `try`; the member's own parameters and body are plain code.
func TestGrammarAdmissionComputedKeyContext(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"effect function f() { class C { [try k()]() { return 2 } } }",
		"effect function f() { class C { static [try k()] = 1 } }",
		"effect function f() { const o = { [try k()]() { return 1 } }; }",
		"effect function f() { const o = { [try k()]: 1 }; }",
		"effect function f() { class C { get [try k()]() { return 1 } } }",
	}
	invalid := []string{
		"class C { [try k()]() { return 2 } }",
		"const o = { [try k()]: 1 };",
		"effect function f() { class C { [k()]() { return try k() } } }",
	}
	vl := grammarParseMode{prose: true, names: true}
	for _, source := range valid {
		if lab.read(lab.g, grammarLexSource(source), vl).count == 0 {
			t.Errorf("computed key in effect code has no derivation: %q", source)
		}
	}
	for _, source := range invalid {
		if lab.read(lab.g, grammarLexSource(source), vl).count != 0 {
			t.Errorf("try outside effect code derives: %q", source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
