package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGrammarAdmissionImportArityQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A's TypeScript inheritance changed; review ImportCall arity")
	}
}

// Only the native ImportCall argument count is grouped. Nested comma
// expressions, options objects, trailing commas and ordinary method calls
// do not change its number of arguments.
func grammarDynamicImportArity(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "import" || i+2 >= len(ts) || ts[i+1].text != "(" ||
			i > 0 && (ts[i-1].text == "." || ts[i-1].text == "?.") {
			continue
		}
		count, depth := 1, 1
		if ts[i+2].text == ")" {
			count = 0
		}
		for j := i + 2; j < len(ts); j++ {
			if depth == 1 && ts[j].text == ")" {
				if count == 0 || count > 2 {
					return true
				}
				break
			}
			if depth == 1 && ts[j].text == "," && j+1 < len(ts) && ts[j+1].text != ")" {
				count++
			}
			switch ts[j].text {
			case "(", "[", "{":
				depth++
			case ")", "]", "}":
				depth--
			}
		}
	}
	return false
}

func TestGrammarAdmissionImportArityKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import();":       true,
		"import\n();":     true,
		"import(a,b,c);":  true,
		"import(a,b,c,);": true,
		"import(a);":      false,
		"import(a,);":     false,
		"import(a,b);":    false,
		"import(a,b,);":   false,
		"import((a,b), { with: { type: x, extra: y } });": false,
		"import(...a);":  false,
		"obj.import();":  false,
		"obj?.import();": false,
		"f();":           false,
	} {
		if got := grammarDynamicImportArity(grammarLexSource(source)); got != want {
			t.Errorf("arity family=%v,want %v: %s", got, want, source)
		}
		if key := grammarAdmissionForm(source); (key == "admission:dynamic-import-arity") != want {
			t.Errorf("pending key=%q,want arity family=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionImportArityRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{"import();", "import(a,b,c);", "import(a,b,c,);"} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == 1450 {
					found = true
					if d.Category() != diagnostics.CategoryMessage || grammarAdmissionSyntaxDiagnostic(d) || d.AffectsBuild() {
						t.Fatalf("expected message-only native arity recovery: %s", d.String())
					}
				}
			}
			if !found || !grammarAdmissionVerdict(t, w, source) {
				t.Fatal("message-only ImportCall arity must remain an admission gap")
			}
		})
	}
	for _, source := range []string{"import(...a);", "import<string>(a);"} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("native ImportCall syntax error mistaken for admission: %s", source)
			}
		})
	}
}
