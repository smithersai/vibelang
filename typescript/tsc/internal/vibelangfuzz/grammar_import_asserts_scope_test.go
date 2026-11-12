package vibelangfuzz

import "testing"

// TypeScript's parseNonArrayType reads an assertion predicate (`asserts x`,
// `asserts this`, each with an optional `is` Type) and a `this` predicate
// (`this is T`) in any type position, and the checker reports TS1228 where a
// predicate is not a return type. checkImportType never walks an import
// type's arguments, so each form compiles there with no syntax diagnostic,
// in the compiler and in stock TypeScript 5.9.3. The identifier predicate
// `x is T` is read in return types only and stays a parse error elsewhere.
// The lab's scoped copies now take the forms the parser reads.
var grammarImportAssertsForms = []string{
	`type A = import("./m").T<asserts x>;`,
	`type A = import("./m").T<asserts this>;`,
	`type A = import("./m").T<asserts x is string>;`,
	`type A = import("./m").T<asserts this is string>;`,
	`type A = import("./m").T<this is string>;`,
	`type A = import("./m").T<Array<asserts x>>;`,
	`type A = import("./m").T<(asserts x)>;`,
	`type A = import("./m").T<asserts x | number>;`,
}

// A bare `asserts` is a type reference, and a predicate as a function type's
// return derives and compiles everywhere.
var grammarImportAssertsPlain = []string{
	`type A = import("./m").T<asserts>;`,
	`type A = import("./m").T<() => asserts x>;`,
	`type A = import("./m").T<() => x is string>;`,
}

// A line break after `asserts`, an identifier predicate in an argument and
// every predicate outside a return type keep their rejection (TS1005, TS1228).
var grammarImportAssertsControls = []string{
	"type A = import(\"./m\").T<asserts\nx>;",
	`type A = import("./m").T<x is string>;`,
	"type A = asserts x;",
	"type A = asserts this;",
	"type A = asserts x is string;",
	"type A = Array<asserts x>;",
	"let v: asserts x;",
}

func TestGrammarAdmissionImportAssertsQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarAdmissionQuote)
}

func TestGrammarAdmissionImportAsserts(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range append(append([]string{}, grammarImportAssertsForms...), grammarImportAssertsPlain...) {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("predicate inside an import argument has no derivation: %s", source)
		}
		if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
			t.Errorf("native-only grammar lacks the predicate inside an import argument: %s", source)
		}
	}
	for _, source := range grammarImportAssertsControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("predicate escaped its import argument boundary or is malformed: %q", source)
		}
	}
}

func TestGrammarAdmissionImportAssertsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(append([]string{}, grammarImportAssertsForms...), grammarImportAssertsPlain...) {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects a predicate inside an import argument as syntax: %s", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("predicate inside an import argument reads as an admission gap: %s", source)
		}
	}
	for _, source := range grammarImportAssertsControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a predicate outside an import argument or a malformed one: %q", source)
		}
	}
}
