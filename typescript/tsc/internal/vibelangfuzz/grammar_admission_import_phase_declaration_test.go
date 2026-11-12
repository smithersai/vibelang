package vibelangfuzz

import "testing"

// Appendix A's ImportDeclaration is an ordinary TypeScript import declaration
// using ModuleSpecifier. TypeScript's declaration takes a phase modifier,
// `defer` or `source`, before its clause; the lab's ImportCall already had
// both phases. The compiler parses every phase clause and leaves the rest to
// the checker: TS18060 for a deferred import under the default module kind,
// TS18058 and TS18059 for a deferred default or named import, TS18112 for a
// namespace or named source import, and nothing for a source default import.
// Stock TypeScript 5.9.3 parses `import defer` the same way; `import source`
// is newer and comes with the native compiler. With neither phase in a
// declaration, every form read as an admission gap.
var grammarImportPhaseDeclarationQuote = "ImportDeclaration = an ordinary TypeScript import declaration using ModuleSpecifier"

var grammarImportPhaseDeclarationForms = []string{
	"module M { }\nimport defer * as ns from M;",
	"module M { }\nimport defer x from M;",
	"module M { }\nimport defer { x } from M;",
	"module M { }\nimport defer x, * as ns from M;",
	"module M { }\nimport defer x, { y } from M;",
	"module M { }\nimport defer\n* as ns from M;",
	"module M { }\nimport defer * as ns from M with { type: \"json\" };",
	"module M { }\nimport source x from M;",
	"module M { }\nimport source * as ns from M;",
	"module M { }\nimport source { x } from M;",
	"module M { }\nimport source x, { y } from M;",
	"import defer * as ns from \"./m\";",
	"import defer x from \"./m\";",
	"import source x from \"./m\";",
	"import source * as ns from \"./m\";",
}

// Ordinary imports whose default binding or type-only binding is named
// defer or source, and an import-equals named defer, derive and compile
// as before.
var grammarImportPhaseDeclarationPlain = []string{
	"import defer from \"./m\";",
	"import source from \"./m\";",
	"import defer, { x } from \"./m\";",
	"module M { }\nimport type defer from M;",
	"module M { }\nimport defer = M;",
}

// A type-only clause after a phase, a namespace import without its name and
// a phase on a re-export have no derivation, and the compiler rejects them as
// syntax. `import defer;` is neither: Appendix A derives it as VIP-40's
// import of a module declaration named defer for its effects.
var grammarImportPhaseDeclarationControls = []string{
	"module M { }\nimport defer type x from M;",
	"module M { }\nimport defer * from M;",
	"export defer * as ns from \"./m\";",
}

func TestGrammarAdmissionImportPhaseDeclarationQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarImportPhaseDeclarationQuote)
}

func TestGrammarAdmissionImportPhaseDeclaration(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range append(append([]string{}, grammarImportPhaseDeclarationForms...), grammarImportPhaseDeclarationPlain...) {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("import declaration has no derivation: %q", source)
		}
	}
	for _, source := range grammarImportPhaseDeclarationControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed phase import derives: %q", source)
		}
	}
}

func TestGrammarAdmissionImportPhaseDeclarationRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(append([]string{}, grammarImportPhaseDeclarationForms...), grammarImportPhaseDeclarationPlain...) {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects an import declaration as syntax: %q", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("import declaration reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarImportPhaseDeclarationControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a malformed phase import: %q", source)
		}
	}
}
