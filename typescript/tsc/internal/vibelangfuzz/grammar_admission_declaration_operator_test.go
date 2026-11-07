package vibelangfuzz

import (
	"context"
	"testing"
)

// A comparison, shift, `as` or `satisfies` still needs its right side, so a
// line break after one creates no declaration position: Appendix A's
// "Anything else is ordinary TypeScript, where the word is an identifier".
func TestGrammarAdmissionDeclarationOperatorPrefixes(t *testing.T) {
	for _, word := range []string{"schema", "error"} {
		for _, prefix := range []string{
			"const b = x >", "const b = x >>", "const b = x >>>", "const b = x <<",
			"const b = x as", "const b = x satisfies", "throw b >",
			"const b = f(x) as", "const b = 'x' as", "const b\n= schema as",
		} {
			source := prefix + "\n" + word + " is 1 + 1;"
			if got := grammarAdmissionDeclarationForm(grammarLexSource(source)); got != "" {
				t.Errorf("an operator continuation became a declaration key %q: %q", got, source)
			}
			if got := grammarAdmissionForm(source); got != "admission:is-operand-precedence" {
				t.Errorf("expression witness lost its precedence key: %q: %q", got, source)
			}
		}
	}
	// A closing type argument list, or a word that is not an operator, still
	// ends the statement before the declaration.
	for source, want := range map[string]string{
		"let x: A<B>\nschema C":          "admission:schema-no-body",
		"f<T>\nschema C":                 "admission:schema-no-body",
		"let x: A<B<C>>\nschema C":       "admission:schema-no-body",
		"as\nschema C":                   "admission:schema-no-body",
		"x;\nas\nschema C":               "admission:schema-no-body",
		"a >> b\nschema C":               "admission:schema-no-body",
		"let x: A<B>\nerror E effect {}": "admission:error-no-end",
	} {
		if got := grammarAdmissionDeclarationForm(grammarLexSource(source)); got != want {
			t.Errorf("declaration control keyed %q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionDeclarationOperatorRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"throw b >\nschema is 1 + 1 ;",
		"const b\n= schema as\nschema is 1 + 1 ;",
	} {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("known precedence witness stopped exposing its mismatch: %q", source)
			}
			checkGrammarAdmission(t, w, "admission:is-operand-precedence", source)
		})
	}
}

// TypeScript's IndexSignature has exactly one typed parameter. Its parser
// reads other bracket lists for recovery and the checker rejects them with
// these grammar diagnostics, which are syntax rejection.
func TestGrammarAdmissionIndexSignatureGrammar(t *testing.T) {
	codes := map[int32]bool{1017: true, 1018: true, 1019: true, 1020: true, 1021: true, 1022: true, 1025: true, 1096: true}
	w := NewWorkspace(t)
	for _, source := range []string{
		"type T = { [ ] };",
		"type T = { [...k: string]: number };",
		"type T = { [public k: string]: number };",
		"type T = { [k?: string]: number };",
		"type T = { [k: string = 'a']: number };",
		"type T = { [k: string] };",
		"type T = { [k: string,]: number };",
		"as as { [ ]\n} ;",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && codes[d.Code()] {
					seen = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Errorf("index signature grammar diagnostic TS%d is not syntax rejection", d.Code())
					}
				}
			}
			if !seen {
				t.Fatalf("no index signature grammar diagnostic; diagnostics=%v", result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("rejected index signature is an admission mismatch")
			}
		})
	}
}
