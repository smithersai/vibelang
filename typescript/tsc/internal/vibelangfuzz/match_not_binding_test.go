package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const notBindingPrefixQuote = "Thus `not(let x)` negates a parenthesized binding pattern and `not[0]` negates an array pattern; `helpers.not(let x)` remains a qualified extractor."
const notBindingInitQuote = "A failed overall test does not undo bindings already initialized; a skipped binding is still uninitialized."

func TestMatchNotBindingQuoted(t *testing.T) {
	text := SpecText("004-match.md")
	for _, quote := range []string{notBindingPrefixQuote, notBindingInitQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 4 no longer says %q", quote)
		}
	}
}

var notBindingPatterns = []string{"not(let x)", "not (const x)", "not { value: let x }", "not [let x]", "not not(let x)", "helpers.not(let x)"}
var notBindingForms = []string{"match", "if", "value", "while"}

// The generator varies the negation's shape, lexical home and trivia. The
// static oracle is admission without EK4702; the case checks runtime meaning.
func FuzzMatchNotBinding(f *testing.F) {
	startShortBudget(f)
	for _, pat := range notBindingPatterns {
		for _, form := range notBindingForms {
			f.Add(pat+"/"+form, uint8(0))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestMatchNotBindingQuoted(t)
		pi, fi := 0, 0
		if key != "" {
			pi = int(key[0]) % len(notBindingPatterns)
			fi = int(key[len(key)-1]) % len(notBindingForms)
		}
		for i, pat := range notBindingPatterns {
			for j, form := range notBindingForms {
				if key == pat+"/"+form {
					pi, fi = i, j
				}
			}
		}
		pat, form := notBindingPatterns[pi], notBindingForms[fi]
		pat = strings.ReplaceAll(pat, "not", []string{"not", "not /* gap */", "not\n"}[int(trivia)%3])
		// Qualifying is a member access, so do not put trivia into that identifier.
		if pi == len(notBindingPatterns)-1 {
			pat = notBindingPatterns[pi]
		}
		body := "return match(s) { when " + pat + ": 1; default: 0; }"
		switch form {
		case "if":
			body = "if (s is " + pat + ") return 1; return 0"
		case "value":
			body = "const hit = s is " + pat + "; return hit ? 1 : 0"
		case "while":
			body = "while (s is " + pat + ") { return 1 }; return 0"
		}
		source := "function not(s: unknown): [unknown] { return [s] }; const helpers = { not }; export function probe(s:unknown) { " + body + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			}
		}
		if len(errors) > 0 {
			Gap(t, "FuzzMatchNotBinding", form+":"+notBindingPatterns[pi], "VIP-7: %s; %s\n%s\n%s", notBindingPrefixQuote, notBindingInitQuote, source, strings.Join(errors, "\n"))
		}
	})
}
