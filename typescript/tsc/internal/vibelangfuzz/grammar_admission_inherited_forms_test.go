package vibelangfuzz

import (
	"strings"
	"testing"
)

// The pinned member pattern starts at this, a MetaProperty or a name.
const grammarMetaPatternQuote = "PatternMatchingMemberExpression[Yield, Await] :\n        `this`\n        MetaProperty\n        IdentifierReference[?Yield, ?Await]"

func TestGrammarAdmissionMetaPatternQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), grammarMetaPatternQuote) {
		t.Fatal("pinned member-pattern production changed; review the lab's PatternMatchingMemberExpression")
	}
}

// Forms Appendix A inherits or pins that the lab's subset did not derive:
// ECMAScript's bitwise NOT and import attributes, TypeScript's
// default-exported interface, and the pinned draft's MetaProperty pattern.
var grammarInheritedForms = []string{
	"const a = ~x, b = ~~x, c = -~x;",
	"const a = x |> ~%;",
	"import x from \"m\" with { type: \"json\" };",
	"import \"m\" with { type: \"json\" };",
	"import y from \"m\" with { };",
	"export * from \"m\" with { \"type\": \"json\", };",
	"export { x } from \"m\" with { type: \"json\" };",
	"export default interface I { x: number }",
	"export default interface I<T> extends J { }",
	"const a = x is import.meta;",
	"const a = x is import.meta.url;",
	"const a = match (x) { when import.meta: 1; default: 0; };",
	"function g() { return x is new.target }",
}

func TestGrammarAdmissionInheritedForms(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range grammarInheritedForms {
		if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count == 0 {
			t.Errorf("inherited form has no derivation: %q", source)
		}
	}
	for _, source := range []string{
		"const a = ~;",
		"import x from \"m\" with;",
		"import x from \"m\" with { type };",
		"import x from \"m\" with { type: json };",
		"import x with { type: \"json\" } from \"m\";",
		"export default interface { x: number }",
		"const a = x is import.other;",
		"const a = x is new.other;",
		"const a = x is import;",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 0 {
			t.Errorf("malformed form has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionInheritedFormsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarInheritedForms {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("an inherited form the compiler accepts reads as an admission gap: %q", source)
		}
	}
}
