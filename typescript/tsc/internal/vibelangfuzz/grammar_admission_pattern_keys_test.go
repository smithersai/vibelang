package vibelangfuzz

import "testing"

// Three forms the compiler parses that neither Appendix A nor the pinned
// draft defines, found by surveying the compiler cases: an explicit ambient
// custom declaration, a class pattern written as a name and an object
// pattern, and `super[key]` as a pattern member expression. Each carries a
// pending key so the oracle reports it; rejection is decided elsewhere.
func TestGrammarAdmissionSurveyedPendingKeys(t *testing.T) {
	for _, c := range []struct{ source, key string }{
		{"export declare error Exported { code: string }", "admission:ambient-custom-declaration"},
		{"declare schema Missing { a: string }", "admission:ambient-custom-declaration"},
		{"declare data NoBody { A }", "admission:ambient-custom-declaration"},
		{"declare schema error Tagged { code: string }", "admission:ambient-custom-declaration"},
		{"const v = match (s) { when Address { let street }: street; default: 0; }", "admission:pattern-name-object"},
		{"const v = match (s) { when K.Address { let street }: street; default: 0; }", "admission:pattern-name-object"},
		{"const v = match (s) { when super[key]: 1; default: 0; }", "admission:pattern-super-element"},
	} {
		if got := grammarAdmissionForm(c.source); got != c.key {
			t.Errorf("key=%q, want %s: %q", got, c.key, c.source)
		}
	}
	for _, source := range []string{
		"declare const declare: number; const x = declare",
		"declare\nerror E",
		"const v = match (s) { when { let street }: street; default: 0; }",
		"const v = match (s) { when Address({ let street }): street; default: 0; }",
		"const v = match (s) { when super.key: 1; default: 0; }",
		"const v = match (s) { when K.Address: 1; default: 0; }",
	} {
		switch grammarAdmissionForm(source) {
		case "admission:ambient-custom-declaration", "admission:pattern-name-object", "admission:pattern-super-element":
			t.Errorf("control keyed as a surveyed pending form: %q", source)
		}
	}
}
