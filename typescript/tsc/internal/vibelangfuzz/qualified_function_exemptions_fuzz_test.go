package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const qualifiedFunctionQuote = "A member `eval` or `Function` is the global itself, so `globalThis.eval(s)` and `globalThis[\"Function\"](\"return 1\")` are `EK0107`, with the two `Function` exemptions above: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed."

func requireQualifiedFunctionQuote(t testing.TB) {
	t.Helper()
	b, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), qualifiedFunctionQuote) {
		t.Fatal("missing qualified Function exemption rule")
	}
}
func TestQualifiedFunctionExemptionsQuoted(t *testing.T) { requireQualifiedFunctionQuote(t) }

var qualifiedFunctionForms = map[string]struct {
	body string
	want int
}{
	"instanceof-as":             {"const x: unknown = () => 1; return x instanceof (globalThis.Function as FunctionConstructor)", 0},
	"instanceof-assert":         {"const x: unknown = () => 1; return x instanceof (<FunctionConstructor>globalThis.Function)", 0},
	"instanceof-satisfies":      {"const x: unknown = () => 1; return x instanceof (globalThis.Function satisfies FunctionConstructor)", 0},
	"instanceof-nonnull":        {"const x: unknown = () => 1; return x instanceof globalThis.Function!", 0},
	"prototype-as":              {"return (globalThis.Function as FunctionConstructor).prototype", 0},
	"prototype-assert":          {"return (<FunctionConstructor>globalThis.Function).prototype", 0},
	"prototype-satisfies":       {"return (globalThis.Function satisfies FunctionConstructor).prototype", 0},
	"prototype-nonnull":         {"return globalThis.Function!.prototype", 0},
	"instanceof-parens-control": {"const x: unknown = () => 1; return x instanceof ((globalThis.Function))", 0},
	"prototype-parens-control":  {"return ((globalThis.Function)).prototype", 0},
	"read-as-control":           {"return (globalThis.Function as FunctionConstructor)", 1},
	"read-satisfies-control":    {"return (globalThis.Function satisfies FunctionConstructor)", 1},
	"read-nonnull-control":      {"return globalThis.Function!", 1},
	"comma-prototype-control":   {"return (0, globalThis.Function).prototype", 1},
}

func FuzzQualifiedFunctionExemptions(f *testing.F) {
	startShortBudget(f)
	requireQualifiedFunctionQuote(f)
	for key := range qualifiedFunctionForms {
		for context := range legacyJavaScriptContexts {
			f.Add(key, context, uint8(0))
		}
		f.Add(key, "plain", uint8(1))
		f.Add(key, "effect", uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, where string, mode uint8) {
		form, ok := qualifiedFunctionForms[key]
		if !ok {
			key = "instanceof-as"
			form = qualifiedFunctionForms[key]
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
			body = strings.ReplaceAll(body, "globalThis.Function", "((globalThis.Function as FunctionConstructor)!)")
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
			Gap(t, "FuzzQualifiedFunctionExemptions", "qualified-function:"+key, "%s: got%d EK0107 want%d\n%s\n%v", qualifiedFunctionQuote, count, form.want, source, r.Diagnostics)
		}
	})
}
