package vibelangfuzz

import "testing"

// TypeScript's parser reports nothing after a bare `declare` identifier
// expression (parseErrorForMissingSemicolonAfter assumes a declaration
// diagnostic was already given), so `declare x: number` is the expression
// `declare` followed by the labeled statement `x: number` on the same line,
// with only name and type errors. The compiler matches TypeScript; the lab
// reads the quirk. Ambient `declare module "m" { }` and `declare global { }`
// are ordinary TypeScript.
func TestGrammarAdmissionDeclareExpression(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"declare x: number",
		"declare x",
		"declare x = 1",
		"declare incomplete: Omit<A, \"id\">",
		"function f() { declare x: number }",
		"declare if (x) {}",
		"declare module \"m\" {} declare module \"n\"; declare global { interface G {} }",
		"const declare = 1; declare + 1; declare(1); declare.x; declare\nx;",
	}
	invalid := []string{
		"export declare x: number",
		"abstract x: number",
		"declare module {}",
	}
	vl := grammarParseMode{prose: true, names: true}
	derives := func(source string) (bool, bool) {
		return lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}).count != 0,
			lab.read(lab.g, grammarLexSource(source), vl).count != 0
	}
	for _, source := range valid {
		if ts, vibe := derives(source); !ts || !vibe {
			t.Errorf("declare derivation TypeScript=%v VibeLang=%v, want both: %q", ts, vibe, source)
		}
	}
	for _, source := range invalid {
		if ts, vibe := derives(source); ts || vibe {
			t.Errorf("invalid declare derives TypeScript=%v VibeLang=%v: %q", ts, vibe, source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
