package vibelangfuzz

import "testing"

// A directed batch of recent TypeScript syntax, written by hand and run
// through the oracle, found seven inherited forms the compiler parses (stock
// TypeScript 5.9.3 parses each; TS1315 is a checker code) that the lab's
// TypeScript subset could not derive: accessor signatures without a body, a
// definite-assignment assertion on a binding, `export as namespace`, an async
// arrow with type parameters, `debugger`, `export default abstract` on a class
// expression and `export * as` with a string name. Appendix A's opening
// sentence covers all seven; the subset now derives them. The first two
// entries are type-only imports the subset derived already.
var grammarDirectedForms = []string{
	"import type * as ns from \"./m\";",
	"import type { U as V } from \"./m\";",
	"abstract class A { abstract m(): void; protected abstract get g(): number }",
	"abstract class A { abstract get g(): number; abstract set g(v: number) }",
	"let d!: number;",
	"let a = 1, d!: number;",
	"export as namespace Lib;",
	"const a2 = async <T,>(x: T) => x;",
	"const a3 = async <T extends object>(x: T): Promise<T> => x;",
	"const a4 = async <T>(x: T) => { return x };",
	"debugger;",
	"function f() { debugger }",
	"export default abstract class {}",
	"export default abstract class Named {}",
	"export * as \"ns name\" from \"./m\";",
	"export * as default from \"./m\";",
}

// A line break before the assertion or the arrow, a namespace export with no
// name, a debugger statement with an operand, a star re-export with no name, a
// default export of the word abstract and a type-only import whose default
// follows its bindings keep their syntax rejection and have no derivation.
// (`import type, { U } from "./m"` is a default import named type.)
var grammarDirectedControls = []string{
	"let d\n!: number;",
	"const a5 = async <T,>(x: T)\n=> x;",
	"export as namespace;",
	"debugger 1;",
	"export * as from \"./m\";",
	"export default abstract {}",
	"import type { U }, V from \"./m\";",
}

func TestGrammarAdmissionDirectedFormsQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarAdmissionQuote)
}

func TestGrammarAdmissionDirectedForms(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarDirectedForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("inherited form has no derivation: %q", source)
		}
		if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
			t.Errorf("native-only grammar lacks the inherited form: %q", source)
		}
	}
	for _, source := range grammarDirectedControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed form derives: %q", source)
		}
	}
}

func TestGrammarAdmissionDirectedFormsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarDirectedForms {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects an inherited form as syntax: %q", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("inherited form reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarDirectedControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a malformed form: %q", source)
		}
	}
}
