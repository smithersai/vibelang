package vibelangfuzz

import "testing"

// Appendix A inherits TypeScript's parameters. ECMAScript's
// FunctionRestParameter is a BindingRestElement: "..." BindingIdentifier or
// "..." BindingPattern, with no "?" and no Initializer. TypeScript's
// parameter grammar admits "?" on a binding pattern too; TS2463 rejects it
// in an implementation signature as a type check, not a grammar error.
func TestGrammarAdmissionRestBindingPattern(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := []string{
		"function f(...[p]: number[]) { return p; }",
		"function f(...[p]) { return p; }",
		"const f = (...{ length }: number[]) => length;",
		"type F = (...[a, b]: [number, string]) => void;",
		"class C { m(...[a]: number[]) { return a; } }",
		"type S = { (...[p]: Missing): Missing }",
		"type F = ([p]?: number[]) => void;",
		"function f([p]?: number[]) { return p; }",
	}
	vibeLang := []string{
		"effect function f(...[p]: number[]) { return p; }",
		"schema S = { ( ... [ p ] : Missing ) : Missing }",
		"schema S = { (...[p]: Missing[]): Missing }",
	}
	invalid := []string{
		"function f(...[p] = []) { return p; }",
		"function f(...[p]?: number[]) { return p; }",
		"function f(...p = []) { return p; }",
		"function f(readonly ...[p]: number[]) { return p; }",
	}
	read := func(g *grammarCfg, mode grammarParseMode, source string) bool {
		return lab.read(g, grammarLexSource(source), mode).count != 0
	}
	vl := grammarParseMode{prose: true, names: true}
	for _, source := range native {
		if !read(lab.ts, grammarParseMode{}, source) || !read(lab.g, vl, source) {
			t.Errorf("rest binding pattern has no derivation: %q", source)
		}
	}
	for _, source := range vibeLang {
		if !read(lab.g, vl, source) {
			t.Errorf("VibeLang rest binding pattern has no derivation: %q", source)
		}
	}
	for _, source := range invalid {
		if read(lab.ts, grammarParseMode{}, source) || read(lab.g, vl, source) {
			t.Errorf("invalid rest parameter derives: %q", source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(append(native, vibeLang...), invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
