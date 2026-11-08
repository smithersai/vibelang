package vibelangfuzz

import (
	"context"
	"testing"
)

// ECMAScript's ShortCircuitExpression is a LogicalORExpression or a
// CoalesceExpression, and CoalesceExpressionHead is a CoalesceExpression or a
// BitwiseORExpression, so `??` never shares an unparenthesized operand with
// `&&` or `||`. TypeScript parses the mixture by precedence, and its checker
// rejects it with the grammar error TS5076, a syntax rejection for the oracle.
func TestGrammarAdmissionCoalesceMixing(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	vl := grammarParseMode{prose: true, names: true}
	derives := func(source string) (bool, bool) {
		return lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}).count != 0,
			lab.read(lab.g, grammarLexSource(source), vl).count != 0
	}
	mixed := []string{
		"const a = 1, b = 2, c = 3; const v = a && b ?? c;",
		"const a = 1, b = 2, c = 3; const v = a ?? b || c;",
		"const a = 1, b = 2, c = 3; const v = a || b ?? c;",
		"const a = 1, b = 2, c = 3; const v = a ?? b && c;",
		// A case-seeded campaign joined two is statements with ??.
		"class Point { }\nexport effect function main ( ) {\nconst effect : unknown = new Point ( )\nconst async = 3\nlet hits = 0\neffect is ( Point ) && ( hits += 1 ) ??\nasync is < 5 && ( hits += 1\n)\nreturn hits\n}",
	}
	grouped := []string{
		"const a = 1, b = 2, c = 3; const v = (a && b) ?? c;",
		"const a = 1, b = 2, c = 3; const v = a ?? (b || c);",
		"const a = 1, b = 2, c = 3; const v = a ?? b ?? c;",
		"const a = 1, b = 2, c = 3; const v = a || b && c;",
	}
	w := NewWorkspace(t)
	for _, source := range mixed {
		if ts, vibe := derives(source); ts || vibe {
			t.Errorf("mixed ?? derives TypeScript=%v VibeLang=%v: %q", ts, vibe, source)
		}
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		rejected := false
		for _, d := range r.Diagnostics {
			rejected = rejected || d.Source() == "" && d.Code() == 5076
		}
		if !rejected {
			t.Errorf("compiler no longer reports TS5076: %q: %v", source, r.Diagnostics)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("TS5076 rejection reads as an admission gap: %q", source)
		}
	}
	for _, source := range grouped {
		if ts, vibe := derives(source); !ts || !vibe {
			t.Errorf("grouped ?? derivation TypeScript=%v VibeLang=%v, want both: %q", ts, vibe, source)
		}
		checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
	}
}
