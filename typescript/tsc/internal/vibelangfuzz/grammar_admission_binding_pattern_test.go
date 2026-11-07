package vibelangfuzz

import "testing"

// Appendix A inherits TypeScript's binding patterns, which are ECMAScript's
// ObjectBindingPattern and ArrayBindingPattern: elisions, nested patterns,
// element initializers, and a final BindingRestElement or
// BindingRestProperty with no initializer and no trailing comma.
func TestGrammarAdmissionBindingPattern(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"const [...p] = [1];",
		"function f(...[...p]: number[]) { return p; }",
		"function f([a, ...rest]: number[]) { return rest; }",
		"const [, b] = [1, 2];",
		"const [a, , c] = [1, 2, 3];",
		"const [a, ...[b, c]] = [1, 2, 3];",
		"const [[a], { b }] = [[1], { b: 2 }];",
		"const [a = 1, [b] = [2]] = [];",
		"const { a, ...rest } = { a: 1, b: 2 };",
		"const { ...rest } = { a: 1 };",
		"const { a: [b], c: { d } = { d: 1 } } = { a: [1], c: { d: 2 } };",
		"const [a,] = [1];",
		"const [,] = [1];",
		"for (const [k, ...vs] of [[1, 2]]) { k; vs; }",
		"type F = (...[a, ...b]: number[]) => void;",
	}
	invalid := []string{
		"const [...p,] = [1];",
		"const [...p = []] = [1];",
		"const [...p, q] = [1];",
		"const { ...{ a } } = { a: 1 };",
		"const { ...rest, } = { a: 1 };",
		"const { ...rest, a } = { a: 1 };",
		"const { a = } = {};",
	}
	vl := grammarParseMode{prose: true, names: true}
	derives := func(source string) (bool, bool) {
		return lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}).count != 0,
			lab.read(lab.g, grammarLexSource(source), vl).count != 0
	}
	for _, source := range valid {
		if ts, vibe := derives(source); !ts || !vibe {
			t.Errorf("binding pattern derivation TypeScript=%v VibeLang=%v, want both: %q", ts, vibe, source)
		}
	}
	for _, source := range invalid {
		if ts, vibe := derives(source); ts || vibe {
			t.Errorf("invalid binding pattern derives TypeScript=%v VibeLang=%v: %q", ts, vibe, source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
