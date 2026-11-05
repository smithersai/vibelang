package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionAsyncForOfContext(t *testing.T) {
	TestGrammarAdmissionForOfAsyncQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"async function f(xs) { for (async of xs) {} }",
		"const f = async function(xs) { for (async of xs) {} };",
		"const f = async (xs) => { for (async of xs) {} };",
		"const obj = { async m(xs) { for (async of xs) {} } };",
		"class C { async m(xs) { for (async of xs) {} } }",
		"async function* f(xs) { for (async of xs) {} }",
		"const f = async function*(xs) { for (async of xs) {} };",
		"function outer() { async function f(xs) { for (async of xs) {} } }",
		"async function outer() { function inner() { return async (xs) => { for (async of xs) {} }; } }",
	}
	invalid := []string{
		"for (async of xs) {}",
		"function f(xs) { for (async of xs) {} }",
		"async function f(xs) { function g() { for (async of xs) {} } }",
		"async function f(xs) { const g = function() { for (async of xs) {} }; }",
		"async function f(xs) { const g = () => { for (async of xs) {} }; }",
		"async function f(xs) { const obj = { m() { for (async of xs) {} } }; }",
		"async function f(xs) { class C { m() { for (async of xs) {} } } }",
		"class C { async(xs) { for (async of xs) {} } }",
	}
	for _, source := range valid {
		if ds := parseAs(parseKind{"context.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
			t.Fatalf("native parser rejected an async context: %v", ds)
		}
	}
	for _, control := range []struct {
		sources []string
		want    bool
	}{{valid, true}, {invalid, false}} {
		for _, source := range control.sources {
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0; got != control.want {
					t.Errorf("%s async context derivation=%v, want %v: %s", name, got, control.want, source)
				}
			}
		}
	}
}
