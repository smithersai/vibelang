package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionAssertedForHeads(t *testing.T) {
	TestGrammarAdmissionForOfAsyncQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	heads := []string{
		"x as T", "x satisfies T", "<T>x", "x!", "(x as T)",
		"x as T as T", "obj.x as T", "x as T satisfies T",
		"<T>x as U", "<T><U>x", "<T>x!", "async as async",
	}
	for _, head := range heads {
		for _, source := range []string{
			"for (" + head + " of xs) {}",
			"for (" + head + " in obj) {}",
			"async function f(xs) { for await (" + head + " of xs) {} }",
		} {
			if ds := parseAs(parseKind{"assertion.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native parser rejected an asserted head: %v", ds)
			}
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if lab.read(g, grammarLexSource(source), grammarParseMode{}).count == 0 {
					t.Errorf("%s asserted head has no derivation: %s", name, source)
				}
			}
		}
	}
	for _, source := range []string{
		"for (x\nas T of xs) {}",
		"for (x\nsatisfies T of xs) {}",
		"for (x as of xs) {}",
		"for (x as T + 1 of xs) {}",
		"for (<T> of xs) {}",
		"for (async of xs) {}",
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0 {
				t.Errorf("%s malformed or restricted head derived: %s", name, source)
			}
		}
	}
}
