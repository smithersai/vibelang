package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarDeclarationPositionQuote = "Anything else is ordinary TypeScript, where the word is an identifier:"

func TestGrammarAdmissionDeclarationPositionQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarDeclarationPositionQuote) {
		t.Fatal("Appendix A declaration position changed; review contextual identifier keys")
	}
}

func TestGrammarAdmissionContextualDeclarationKeys(t *testing.T) {
	for _, word := range []string{"schema", "error"} {
		for _, prefix := range []string{
			"const b =", "let b; b =", "const f = () =>", "f(",
			"const xs = [", "const b = obj.", "const b = obj?.",
			"const b = x &&", "const b = x ??", "const b = x ? 1 :",
			"const b = typeof",
		} {
			source := prefix + "\n" + word + " is 1 + 1;"
			if got := grammarAdmissionDeclarationForm(grammarLexSource(source)); got != "" {
				t.Errorf("an expression continuation became a declaration key %q: %q", got, source)
			}
			if got := grammarAdmissionForm(source); got != "admission:is-operand-precedence" {
				t.Errorf("expression witness lost its precedence key: %q: %q", got, source)
			}
		}
		for _, suffix := range []string{" is 1;", " satisfies T;", ".value;"} {
			source := "const b =\n" + word + suffix
			if got := grammarAdmissionDeclarationForm(grammarLexSource(source)); got != "" {
				t.Errorf("identifier control acquired a declaration key %q: %q", got, source)
			}
		}
		source := "const b =\n" + word + " is 1 + 1 ;"
		key, got := grammarAdmissionInput([]byte("key:is-contextual-" + word + "\n" + source))
		if got != source || key != "admission:is-contextual-"+word {
			t.Fatalf("keyed contextual witness changed during replay: key=%q source=%q", key, got)
		}
	}
	for source, want := range map[string]string{
		"schema C":                                  "admission:schema-no-body",
		"schema C string":                           "admission:schema-no-body",
		"x;\nschema C":                              "admission:schema-no-body",
		"const b = x!\nschema C":                    "admission:schema-no-body",
		"function f() { return\nschema C }":         "admission:schema-no-body",
		"obj.typeof\nschema C":                      "admission:schema-no-body",
		"obj.new\nerror E effect {}":                "admission:error-no-end",
		"function f() { await\nerror E effect {} }": "admission:error-no-end",
		"error E effect {}":                         "admission:error-no-end",
		"x;\nerror E effect {}":                     "admission:error-no-end",
	} {
		if got := grammarAdmissionDeclarationForm(grammarLexSource(source)); got != want {
			t.Errorf("declaration control keyed %q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionContextualDeclarationRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, word := range []string{"schema", "error"} {
		source := "const b =\n" + word + " is 1 + 1 ;"
		if !grammarAdmissionVerdict(t, w, source) {
			t.Fatalf("known precedence witness stopped exposing its mismatch: %q", source)
		}
		for _, valid := range []string{
			"const b =\n" + word + " is 1;",
			"const b =\n(" + word + " is 1) + 1;",
		} {
			if grammarAdmissionVerdict(t, w, valid) {
				t.Fatalf("deriving expression control became a mismatch: %q", valid)
			}
		}
		t.Run(word+"-pending", func(t *testing.T) {
			checkGrammarAdmission(t, w, "admission:is-contextual-"+word, source)
		})
	}
}
