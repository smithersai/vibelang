package vibelangfuzz

import "testing"

// TypeScript's parser reads an import type's type arguments as a bracketed
// list that may be empty or end in a comma, and its checker runs the
// TypeArguments grammar check (TS1099 for an empty list, TS1009 for a
// trailing comma) only on type references and expressions, not on import
// types: stock TypeScript 5.9.3 reports TS2314 alone for
// `import("./m").T<>` and nothing for `typeof import("./m")<>` or
// `import("./m").T<string,>`. The lab's ImportType took TypeArguments with
// at least one type, so a campaign mutation that emptied the list read as
// a mismatch. The lab now takes the empty and trailing-comma lists after an
// import type; a type reference keeps TypeScript's rejection.
var grammarImportTypeArgumentForms = []string{
	"type X = import(\"./m\").T<>;",
	"type X = typeof import(\"./m\")<>;",
	"type X = import(\"./m\")<>;",
	"type X = import(\"./m\").T<string,>;",
	"const f = (x: string & import(\"./m\").B<>) => x;",
	"export const call = effect (input: string & import(\"./m\").B<>) => input",
	"function g(): import(\"./m\").T<> { return g() }",
	"type X = import(\"./m\").T<>[];",
}

func TestGrammarAdmissionImportTypeArguments(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarImportTypeArgumentForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("import type argument form has no derivation: %q", source)
		}
	}
	for _, source := range []string{
		// A type reference's empty list is TS1099 and has no derivation.
		"type X = Array<>;",
		"type X = import(\"./m\").T<,>;",
		"type X = import(\"./m\").T<string,,>;",
		// The line-break rule stands between the import type and `<`.
		"type X = import(\"./m\")\n<>;",
	} {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed import type argument form has a derivation: %q", source)
		}
	}
}

func TestGrammarAdmissionImportTypeArgumentsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append([]string{
		"type X = Array<>;",
		"type X = import(\"./m\").T<,>;",
	}, grammarImportTypeArgumentForms...) {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("an import type argument form reads as an admission gap: %q", source)
		}
	}
}
