package vibelangfuzz

import (
	"fmt"
	"testing"
)

// TypeScript's parseEntityName consumes a dot before `<` wherever a type
// reference is read, and the checker reports that JSDoc-style generic as
// TS8020 from checkTypeReferenceNode. checkImportType never walks an import
// type's arguments, so a dotted reference nested anywhere inside them, at any
// depth, compiles with no syntax diagnostic: stock TypeScript 5.9.3 reports
// nothing for `import("./m.js").T<Array.<Missing<>,>>` when the module exports
// `type T<A = number> = A`, and TS8020 for an ordinary `Array.<string>`. The
// lab's scoped copy of the type productions admits the dotted reference under
// import arguments; an ordinary reference keeps TS8020 and no derivation.
var grammarImportNestedDottedWitness = `type X = import("./m").T<Array.<Missing<>,>>;`

func grammarImportNestedDottedForms() []string {
	var sources []string
	for _, arg := range []string{
		"Array.<string>", "Array.<>", "Array.<Missing<>,>",
		"NS.Array.<string>", "Array.<Array.<string>>", "Array\n.<string>",
	} {
		for _, wrapper := range []string{"%s", "(%s)", "%s[]", "{ value: %s }", "(input: %s) => number"} {
			for _, qualifier := range []string{"T", "T."} {
				sources = append(sources, `type X = import("./m").`+qualifier+"<"+fmt.Sprintf(wrapper, arg)+">;")
			}
		}
	}
	return sources
}

// An ordinary reference, a reference nested outside an import argument, a
// line break after the dot, a doubled dot and a missing list element keep
// their rejection: TS8020 from the checker for the first four, TS1110,
// TS1003 and TS1005 from the parser for the rest.
var grammarImportNestedDottedControls = []string{
	"type X = Array.<string>;", "type X = NS.Array.<string>;",
	"type X = (Array.<string>);", "type X = Array<Array.<string>>;",
	`type X = import("./m").T<Array. <,>>;`,
	`type X = import("./m").T<Array..<string>>;`,
	`type X = import("./m").T<Array.` + "\n" + `<string>>;`,
	`type X = import("./m").T<Array.<string,,>>;`,
}

func TestGrammarAdmissionImportNestedDottedQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, "VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below.")
}

func TestGrammarAdmissionImportNestedDotted(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range append([]string{grammarImportNestedDottedWitness}, grammarImportNestedDottedForms()...) {
		t.Run(source, func(t *testing.T) {
			if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
				t.Errorf("native dotted import argument has no derivation: %s", source)
			}
			if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
				t.Errorf("native-only grammar lost the dotted import argument: %s", source)
			}
		})
	}
	for _, source := range grammarImportNestedDottedControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("dotted reference recovery escaped its import argument boundary: %s", source)
		}
	}
}

func TestGrammarAdmissionImportNestedDottedRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append([]string{grammarImportNestedDottedWitness}, grammarImportNestedDottedForms()...) {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("native dotted import argument reads as an admission gap: %s", source)
		}
	}
	for _, source := range grammarImportNestedDottedControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a dotted reference outside an import argument or a malformed list: %s", source)
		}
	}
}
