package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionForAwaitAsyncHead(t *testing.T) {
	TestGrammarAdmissionForOfAsyncQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"async function f(xs) { for await (async of xs) {} }",
		"async function f(xs) { for\nawait\n(async\nof xs) {} }",
		"async function f(xs) { for await (const async of xs) {} }",
		"let async; async function f(xs) { for await (async of xs) { async; } }",
		"async function f(xs) { for await ((async) of xs) {} }",
	}
	invalid := []string{
		"function f(xs) { for (async of xs) {} }",
		"async function f(xs) { for await (async in xs) {} }",
		"async function f(xs) { for await (async; ;) {} }",
		"async function f(xs) { for await (async = 1 of xs) {} }",
		"async function f(xs) { for await (let of xs) {} }",
	}
	for _, source := range valid {
		if ds := parseAs(parseKind{"head.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
			t.Fatalf("native parser rejected a for-await head: %v", ds)
		}
	}
	for _, control := range []struct {
		sources []string
		want    bool
	}{{valid, true}, {invalid, false}} {
		for _, source := range control.sources {
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0; got != control.want {
					t.Errorf("%s for-await head derivation=%v, want %v: %s", name, got, control.want, source)
				}
			}
		}
	}
}
