package vibelangfuzz

import "testing"

// Pattern prefixes do not exempt arithmetic after the complete is test.
// Cross product controls keep signed and relational operands separate from
// the looser relational, logical and parenthesized continuations.
func TestGrammarAdmissionIsPrefixPrecedenceKeys(t *testing.T) {
	patterns := []string{"1", "-1", "+1", "> 1", "> -1", ">= +1", "< 1", "== 1", "!= -1", "not 1", "not > 1", "not -1", "Box.n", "[1]"}
	for _, pattern := range patterns {
		for _, op := range []string{"+", "-", "*", "/", "%", "**", "<<", ">>", ">>>"} {
			source := "const b = x is " + pattern + " " + op + " 1;"
			if !grammarIsOperandPrecedence(grammarLexSource(source)) ||
				grammarAdmissionForm(source) != "admission:is-operand-precedence" {
				t.Errorf("tighter operator lost its exact pending key: %s", source)
			}
		}
		for _, source := range []string{
			"const b = x is " + pattern + ";",
			"const b = (x is " + pattern + ") + 1;",
			"const b = x is " + pattern + " < 2 + 3;",
			"const b = x is " + pattern + " && y + 1;",
			"const b = x is " + pattern + " | y + 1;",
			"const b = x is " + pattern + " ^ y + 1;",
			"const b = x is " + pattern + " & y + 1;",
		} {
			if grammarIsOperandPrecedence(grammarLexSource(source)) {
				t.Errorf("valid pattern or continuation entered pending family: %s", source)
			}
		}
	}
}

func TestGrammarAdmissionIsPrefixPrecedenceRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source   string
		mismatch bool
	}{
		{"const b = x is > 1 + 1; ;", true},
		{"const b = x is > -1 + 1;", true},
		{"const b = x is <= +1 * 2;", true},
		{"const b = x is -1 + 1;", true},
		{"const b = x is not -1 + 1;", true},
		{"const b = x is > -1;", false},
		{"const b = x is <= +1;", false},
		{"const b = (x is > 1) + 1;", false},
		{"const b = x is > 1 < 2 + 3;", false},
		{"const b = x is > 1 | 2 + 3;", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			if got := grammarAdmissionVerdict(t, w, c.source); got != c.mismatch {
				t.Fatalf("admission mismatch=%v, want %v: %s", got, c.mismatch, c.source)
			}
		})
	}
}

// A keyed saved input must replay its witness rather than enter mutation.
func TestGrammarAdmissionIsPrefixCorpusReplay(t *testing.T) {
	const source = "const b = x is > 1 + 1; ;"
	key, got := grammarAdmissionInput([]byte("key:is-relational-operand-precedence\n" + source))
	if got != source || key != "admission:is-relational-operand-precedence" {
		t.Fatalf("saved witness changed during replay: key=%q, source=%q", key, got)
	}
	if grammarAdmissionForm(got) != "admission:is-operand-precedence" {
		t.Fatal("saved witness lost the existing precedence gap")
	}
}
