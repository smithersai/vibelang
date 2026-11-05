package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestGrammarAdmissionInstantiationASIQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed")
	}
}

var grammarInstantiationASIControls = []string{
	"schema\nC<T>\n{ a: T\nT }",
	"C<T>\n{}",
	"C<T>\n{ T; }",
	"C<T>\n{ a: T; T; }",
	"C<T>\n{ a: T\nT }",
	"C<T>\r\n{ T; }",
	"C<T> /* comment */\n{ T; }",
	"(C<T>)\n{ T; }",
	"obj.m<T>\n{ T; }",
	"C<Array<T>>\n{ T; }",
	"const value = C<T>\n{ T; }",
	"let value = C<T>\n{ a: T; }",
	"value = C<T>\n{ T; }",
	"function f() { return C<T>\n{ T; } }",
}

func TestGrammarAdmissionInstantiationASI(t *testing.T) {
	TestGrammarAdmissionInstantiationASIQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarInstantiationASIControls {
		if lab.read(lab.g, grammarLexSource(source), mode).count == 0 {
			t.Errorf("native instantiation before a new-line block has no derivation: %s", source)
		}
		if lab.read(lab.ts, grammarLexSource(source), mode).count == 0 {
			t.Errorf("native TS instantiation derivation missing: %s", source)
		}
	}
	// The bounded CFG also retains the competing relational reading of
	// C<T> followed by an object. Admission requires a derivation; ordinary
	// unambiguous blocks must still have exactly one.
	for _, source := range []string{"value\n{}", "(C<T>)\n{}"} {
		if got := lab.read(lab.g, grammarLexSource(source), mode).count; got != 1 {
			t.Errorf("native block boundary has %d derivations, want one: %s", got, source)
		}
	}
	for _, source := range []string{
		"C<T>{ a: T T }",
		"C<T> { a: T\nT }",
		"C<T>\n{ a: T T }",
		"const value = C<T> { T; }",
	} {
		if lab.read(lab.g, grammarLexSource(source), mode).count != 0 {
			t.Errorf("missing ASI or malformed block gained derivation: %s", source)
		}
	}
}
func TestGrammarAdmissionInstantiationASIRegression(t *testing.T) {
	TestGrammarAdmissionInstantiationASIQuoted(t)
	w := NewWorkspace(t)
	const source = "schema\nC < T >\n{ a :\nT\nT }"
	result, err := w.Compile(context.Background(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range result.Diagnostics {
		if grammarAdmissionSyntaxDiagnostic(d) {
			t.Fatalf("native witness unexpectedly rejected syntax: %v", d)
		}
	}
	if grammarAdmissionVerdict(t, w, source) {
		t.Fatal("native instantiation ASI still reported as admission gap")
	}
	checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
	// TypeScript commits to the instantiation reading at the line break.
	// Its rejection guards the oracle even though the bounded CFG can also
	// read the argument as a relational expression with an object operand.
	for _, rejected := range []string{"f(C<T>\n{})", "[C<T>\n{}]"} {
		t.Run("native-delimiter-"+rejected[:1], func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(rejected))
			if err != nil {
				t.Fatal(err)
			}
			rejectedSyntax := false
			for _, d := range result.Diagnostics {
				rejectedSyntax = rejectedSyntax || grammarAdmissionSyntaxDiagnostic(d)
			}
			if !rejectedSyntax {
				t.Fatalf("missing native syntax rejection for %s", rejected)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(rejected), rejected)
		})
	}
	t.Run("raw-witness", func(t *testing.T) {
		key, got := grammarAdmissionInput([]byte("b810000100000000010"))
		if got != source {
			t.Fatalf("instantiation ASI replay drifted: %q: %s", key, got)
		}
		checkGrammarAdmission(t, w, key, got)
	})
}
