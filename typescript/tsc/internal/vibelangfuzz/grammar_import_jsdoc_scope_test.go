package vibelangfuzz

import "testing"

// TypeScript's parser reads the JSDoc type forms `?T`, `T?`, `*` and `!T` in
// a type position (parseNonArrayType and parsePostfixTypeOrHigher) and the
// checker reports them where it checks the type: TS17020 for `?T` and `!T`,
// TS17019 for `T?`, TS8020 for `*`. checkImportType never walks an import
// type's arguments, so each form compiles there with no syntax diagnostic;
// stock TypeScript 5.9.3 reports nothing. A Deep mutation found the
// non-nullable prefix on the dotted reference of the nested-dotted family,
// `import("./m").T<!Array.<Missing<>,>>`, and the lab's scoped copies now
// take all four forms. The JSDoc function, variadic and optional forms and a
// bare `?` are parse errors in the compiler and keep no derivation.
var grammarImportJsdocForms = []string{
	`type A = import("./m").T<?string>;`,
	`type A = import("./m").T<string?>;`,
	`type A = import("./m").T<*>;`,
	`type A = import("./m").T<!string>;`,
	`type A = import("./m").T<?Array.<string>>;`,
	`type A = import("./m").T<!Array.<Missing<>,>>;`,
	`type A = import("./m").T<Array<?string>>;`,
	`type A = import("./m").T<{ a: ?string }>;`,
	`type A = import("./m").T<(?string)[]>;`,
}

// The nullable prefix over an effect type derives in the lab only.
var grammarImportJsdocLabForms = []string{
	`type A = import("./m").T<?string!never>;`,
}

var grammarImportJsdocControls = []string{
	`type A = import("./m").T<function(string): number>;`,
	`type A = import("./m").T<...string>;`,
	`type A = import("./m").T<string=>;`,
	`type A = import("./m").T<?>;`,
	`type A = import("./m").T<number!?string>;`,
	"type A = ?string;",
	"type A = string?;",
	"type A = *;",
	"type A = !string;",
	"type A = Array<?string>;",
}

func TestGrammarAdmissionImportJsdocQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarAdmissionQuote)
}

func TestGrammarAdmissionImportJsdoc(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarImportJsdocForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("JSDoc form inside an import argument has no derivation: %s", source)
		}
		if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
			t.Errorf("native-only grammar lacks the JSDoc form inside an import argument: %s", source)
		}
	}
	for _, source := range grammarImportJsdocLabForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("JSDoc form over an effect type has no derivation: %s", source)
		}
	}
	for _, source := range grammarImportJsdocControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("JSDoc form escaped its import argument boundary or is malformed: %s", source)
		}
	}
}

func TestGrammarAdmissionImportJsdocRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(append([]string{}, grammarImportJsdocForms...), grammarImportJsdocLabForms...) {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects a JSDoc form inside an import argument as syntax: %s", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("JSDoc form inside an import argument reads as an admission gap: %s", source)
		}
	}
	for _, source := range grammarImportJsdocControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a JSDoc form outside an import argument or a malformed one: %s", source)
		}
	}
}
