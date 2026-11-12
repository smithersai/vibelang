package vibelangfuzz

import "testing"

// Appendix A writes ReturnType as ":" Type with the gloss "(TypeScript's
// return-type annotation, parsed as TypeScript parses it; …)". TypeScript's
// annotation is a type or a type predicate, and the compiler parses a
// predicate after every effect signature: `effect (x): x is string => true`
// reports EK0106 (the written return type is not an Effect) with no syntax
// diagnostic, as stock TypeScript 5.9.3 reports TS1064 alone for
// `async (x): x is string => true`. The lab built the appendix production
// literally, so a predicate return had no derivation. grammarBuildGrammar now
// reads that gloss as the subset's definition of the same name.
var grammarEffectPredicateReturnQuote = `ReturnType = ":" Type   (TypeScript's return-type annotation, parsed as TypeScript parses it; a type takes no Effect parameter)`

var grammarEffectPredicateReturnForms = []string{
	"effect (x): x is string => true",
	"effect (x): asserts x => { }",
	"const f = effect (x: unknown): x is string => true",
	"const f = effect (x: unknown): asserts x is string => { }",
	"const f = effect (x: unknown): this is string => true",
	"const f = effect <T>(x: T): x is T => true",
	"effect function f(x: unknown): x is string { return true }",
	"effect function f(x: unknown): asserts x { }",
	"class C { effect m(x: unknown): x is string { return true } }",
	"class C { effect m(x: unknown): asserts this { } }",
	"const o = { effect m(x: unknown): x is string { return true } }",
}

// A predicate with no type, and a line break before `is` (TypeScript reads
// the name as the whole annotation and the `is` line as an error), keep their
// syntax rejection and have no derivation.
var grammarEffectPredicateReturnControls = []string{
	"effect (x): x is => true",
	"effect (x): x\nis string => true",
	"effect function f(x: unknown): x\nis string { return true }",
}

func TestGrammarAdmissionEffectPredicateReturnQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, grammarEffectPredicateReturnQuote)
}

func TestGrammarAdmissionEffectPredicateReturn(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarEffectPredicateReturnForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("effect signature with a predicate return has no derivation: %s", source)
		}
	}
	for _, source := range grammarEffectPredicateReturnControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("malformed predicate return derives: %s", source)
		}
	}
}

func TestGrammarAdmissionEffectPredicateReturnRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarEffectPredicateReturnForms {
		if grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler rejects a predicate return as syntax: %s", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("predicate return reads as an admission gap: %s", source)
		}
	}
	for _, source := range grammarEffectPredicateReturnControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a malformed predicate return: %s", source)
		}
	}
}
