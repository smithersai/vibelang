package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const qualifiedPrototypeKeyQuote = "A member `eval` or `Function` is the global itself, so `globalThis.eval(s)` and `globalThis[\"Function\"](\"return 1\")` are `EK0107`, with the two `Function` exemptions above: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed."

func requireQualifiedPrototypeKeyQuote(t testing.TB) {
	t.Helper()
	b, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), qualifiedPrototypeKeyQuote) {
		t.Fatal("missing qualified Function exemption rule")
	}
}
func TestQualifiedPrototypeKeysQuoted(t *testing.T) { requireQualifiedPrototypeKeyQuote(t) }

var qualifiedPrototypeKeyForms = map[string]struct {
	body string
	want int
}{
	"grouped":              {"const literal = \"prototype\" as const; return globalThis.Function[(\"prototype\")]", 0},
	"as-const":             {"const literal = \"prototype\" as const; return globalThis.Function[\"prototype\" as const]", 0},
	"assertion":            {"const literal = \"prototype\" as const; return globalThis.Function[<\"prototype\">\"prototype\"]", 0},
	"satisfies":            {"const literal = \"prototype\" as const; return globalThis.Function[\"prototype\" satisfies string]", 0},
	"non-null":             {"const literal = \"prototype\" as const; return globalThis.Function[\"prototype\"!]", 0},
	"template":             {"const literal = \"prototype\" as const; return globalThis.Function[(`prototype`)]", 0},
	"nested":               {"const literal = \"prototype\" as const; return globalThis.Function[((\"prototype\" as const)!)]", 0},
	"optional":             {"const literal = \"prototype\" as const; return globalThis.Function?.[(\"prototype\")]", 0},
	"computed-receiver":    {"const literal = \"prototype\" as const; return globalThis[\"Function\"][(\"prototype\")]", 0},
	"literal-control":      {"const literal = \"prototype\" as const; return globalThis.Function[\"prototype\"]", 0},
	"property-control":     {"const literal = \"prototype\" as const; return globalThis.Function.prototype", 0},
	"other-member-control": {"const literal = \"prototype\" as const; return globalThis.Function.name", 1},
	"alias-key-control":    {"const literal = \"prototype\" as const; return globalThis.Function[literal]", 1},
}

func FuzzQualifiedPrototypeKeys(f *testing.F) {
	startShortBudget(f)
	requireQualifiedPrototypeKeyQuote(f)
	for key := range qualifiedPrototypeKeyForms {
		for context := range legacyJavaScriptContexts {
			f.Add(key, context, uint8(0))
		}
		f.Add(key, "plain", uint8(1))
		f.Add(key, "effect", uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, where string, mode uint8) {
		form, ok := qualifiedPrototypeKeyForms[key]
		if !ok {
			key = "grouped"
			form = qualifiedPrototypeKeyForms[key]
		}
		wrap, ok := legacyJavaScriptContexts[where]
		if !ok {
			wrap = legacyJavaScriptContexts["plain"]
		}
		body := form.body
		switch mode % 4 {
		case 1:
			body = strings.ReplaceAll(body, "globalThis.Function", "globalThis/* member */.Function")
		case 2:
			body = "// café 😀\n" + body
		case 3:
			body = strings.ReplaceAll(body, "globalThis.Function", "globalThis[\"Function\"]")
		}
		source := wrap(body) + "\n"
		r, err := w.Compile(context.Background(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 107 {
				count++
			}
		}
		if count != form.want {
			Gap(t, "FuzzQualifiedPrototypeKeys", "qualified-prototype-key:"+key, "%s: got%d EK0107 want%d\n%s\n%v", qualifiedPrototypeKeyQuote, count, form.want, source, r.Diagnostics)
		}
	})
}
