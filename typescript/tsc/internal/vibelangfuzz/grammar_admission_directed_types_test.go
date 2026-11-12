package vibelangfuzz

import "testing"

// The second directed batch (type-level and member syntax) found two more
// inherited forms the compiler parses, as stock TypeScript 5.9.3 does, that
// the lab's TypeScript subset could not derive: an import type with import
// attributes (`import("./m", { with: { "resolution-mode": "import" } }).T`;
// TypeScript's parseImportType takes a `with` container after the specifier;
// the compiler's TypeScript rejects the older `assert` container, TS2880) and
// a constructor parameter property with the `override` modifier (TS4113 or
// TS4112 from the checker). The subset now writes both.
var grammarDirectedTypeForms = []string{
	"type A = import(\"./m\", { with: { \"resolution-mode\": \"import\" } }).T;",
	"type A = import(\"./m\", { with: {} }).T;",
	"type A = import(\"./m\", { with: { type: \"json\" } });",
	"type A = import(\"./m\", { with: { \"resolution-mode\": \"import\" } }).T<string>;",
	"type A = typeof import(\"./m\", { with: { \"resolution-mode\": \"import\" } });",
	"class B { } class C extends B { constructor(override readonly w: boolean) { super() } }",
	"class B { } class C extends B { constructor(override w: boolean) { super() } }",
	"class B { } class C extends B { constructor(private readonly x: number, public y?: string, protected z = 1, override readonly w: boolean) { super() } }",
}

// An attribute container with another key or the retired `assert` key, a
// trailing comma after the container and a comma with no container keep
// their syntax rejection and have no derivation.
var grammarDirectedTypeControls = []string{
	"type A = import(\"./m\", { other: {} }).T;",
	"type A = import(\"./m\", { assert: { \"resolution-mode\": \"import\" } }).T;",
	"type A = import(\"./m\", { with: {} },).T;",
	"type A = import(\"./m\",).T;",
}

func TestGrammarAdmissionDirectedTypesQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarAdmissionQuote)
}

func TestGrammarAdmissionDirectedTypes(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarDirectedTypeForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("inherited form has no derivation: %q", source)
		}
		if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
			t.Errorf("native-only grammar lacks the inherited form: %q", source)
		}
	}
	for _, source := range grammarDirectedTypeControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed form derives: %q", source)
		}
	}
}

func TestGrammarAdmissionDirectedTypesRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarDirectedTypeForms {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects an inherited form as syntax: %q", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("inherited form reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarDirectedTypeControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a malformed form: %q", source)
		}
	}
}
