package vibelangfuzz

import "testing"

// Appendix A's keyword table makes `effect` a keyword at a statement start
// before "a name other than `as`, `satisfies` or `is`, then `(` or `<`" (the
// EffectShorthand head). An identifier `effect` before an is test with a
// parenthesized pattern stays an identifier, as `effect is Object` and
// `x is (Object)` already did.
func TestGrammarAdmissionEffectIdentifierBeforeIs(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	identifier := []string{
		"const effect: unknown = 1; effect is (Object);",
		"const effect: unknown = 1; let hits = 0;\neffect is (Object) && (hits += 1);",
		"const effect: unknown = 1; effect is Object;",
		"const effect: unknown = 1; effect satisfies unknown;",
		"const effect = (x: number) => x; effect as unknown;",
	}
	for _, source := range identifier {
		toks := grammarLexSource(source)
		for _, effect := range []bool{false, true} {
			kw := lab.prose.mark(toks, effect, lab.g)
			for i, tok := range toks {
				if tok.text == "effect" && i > 1 && kw[i] == grammarKwYes {
					t.Errorf("effect@%d marked a keyword in %q", i, source)
				}
			}
		}
		if lab.read(lab.g, toks, grammarParseMode{prose: true, names: true}).count == 0 {
			t.Errorf("identifier effect has no derivation: %q", source)
		}
	}
	// The shorthand head itself keeps its keyword reading.
	for _, source := range []string{"effect run(x: number) { return x }", "effect run<T>(x: T) { return x }"} {
		toks := grammarLexSource(source)
		if kw := lab.prose.mark(toks, false, lab.g); kw[0] != grammarKwYes {
			t.Errorf("shorthand head not a keyword (state %d): %q", kw[0], source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range identifier {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
