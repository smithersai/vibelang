package vibelangfuzz

import "testing"

// Appendix A inherits TypeScript's types. Its parseEntityName consumes a dot
// before "<"; parseImportType then reads the argument list. Stock tsc 5.9.3
// accepts the import forms below, including with a resolved generic export.
// An ordinary reference such as Array.<number> instead reports TS8020.
var grammarImportTypeDottedArgumentForms = []string{
	"type X = import(\"./m\").T.<>;",
	"type X = import(\"./m\").T.<number>;",
	"type X = import(\"./m\").T.<number,>;",
	"type X = import(\"./m\").T.U.<number>;",
	"type X = typeof import(\"./m\").T.<number>;",
	"type X = import(\"./m\").T\n.<number>;",
	"type X = import(\"./m\").T.<number>[];",
	"const f = (x: import(\"./m\").T.<number>) => x;",
}

func TestGrammarAdmissionImportTypeDottedArguments(t *testing.T) {
	w := NewWorkspace(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range grammarImportTypeDottedArgumentForms {
		t.Run(source, func(t *testing.T) {
			if grammarArrowSafeSyntaxRejected(t, w, source) {
				t.Fatalf("inherited import type rejected as syntax: %s", source)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("dotted import type arguments still reported as an admission gap")
			}
			if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count == 0 {
				t.Fatal("dotted import type arguments have no derivation")
			}
		})
	}
}

func TestGrammarAdmissionImportTypeDottedArgumentControls(t *testing.T) {
	w := NewWorkspace(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"type X = Array.<number>;",
		"type X = A.B.<number>;",
		"type X = import(\"./m\").<number>;",
		"type X = import(\"./m\").T.;",
		"type X = import(\"./m\").T..U;",
		"type X = import(\"./m\").T.\n<number>;",
		"type X = import(\"./m\").T.<,>;",
		"type X = import(\"./m\").T.<number,,>;",
		"type X = import(\"./m\").T.<number>.U;",
	} {
		t.Run(source, func(t *testing.T) {
			if !grammarArrowSafeSyntaxRejected(t, w, source) {
				t.Fatalf("compiler admits malformed dotted type: %s", source)
			}
			if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 0 {
				t.Fatal("malformed dotted type derives")
			}
		})
	}
}
