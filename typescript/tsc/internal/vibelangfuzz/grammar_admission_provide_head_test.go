package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarProvideHeadQuote = "at a statement start when a valid [ProvideStatement](#providestatement) head parses"
const grammarProvideVIPHeadQuote = "`provide` is a keyword only when the tokens from `provide` through a `{` on the line where the last provider ends parse as the head of a provide statement"
const grammarProvideHeadProduction = "ProvideStatement = [+Effect] \"provide\" [no LineTerminator here] Provider ([no LineTerminator here] \",\" [no LineTerminator here] Provider)* [no LineTerminator here] Block"

// grammarProvideKeywordHeadAt checks the independent grammar prefix. Keyword
// marking is disabled in the probe to avoid recursively classifying the same
// provide token. The full program still derives with all prose rules enabled.
func grammarProvideKeywordHeadAt(g *grammarCfg, toks []grammarToken, at int) bool {
	nt, ok := g.index["ProvideKeywordHead⁺"]
	if !ok {
		return false
	}
	probe := *g
	probe.start, probe.startE = nt, nt
	parsed := probe.parse(toks[at:], grammarParseMode{effect: true, prose: true, names: true}, nil)
	return len(parsed.ends[[2]int32{int32(nt), 0}]) > 0
}

func TestGrammarAdmissionProvideHeadQuoted(t *testing.T) {
	for _, quote := range []string{grammarProvideHeadQuote, grammarProvideHeadProduction} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatal("Appendix A provide keyword head changed; review contextual lookahead")
		}
	}
	if !strings.Contains(SpecText("../vips/0012-provide.md"), grammarProvideVIPHeadQuote) {
		t.Fatal("VIP-12 keyword cover rule changed; review provide head derivation")
	}
	TestGrammarAdmissionAssertedIsQuoted(t)
}

var grammarProvideIdentifierSources = []string{
	"provide is is is is as join\n[\n]",
	"provide is 1;",
	"provide is M;",
	"provide is M as boolean;",
	"provide is M as T\n[];",
	"provide is is is is satisfies T;",
	"provide(x);",
	"provide[0] = 1;",
	"provide - 1;",
	"provide / 2;",
	"provide.value;",
	"provide\nis;",
}

func TestGrammarAdmissionProvideIdentifier(t *testing.T) {
	TestGrammarAdmissionProvideHeadQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range grammarProvideIdentifierSources {
		t.Run(source, func(t *testing.T) {
			tokens := grammarLexSource(source)
			raw := lab.read(lab.g, tokens, grammarParseMode{}).count
			prose := lab.read(lab.g, tokens, grammarParseMode{prose: true, names: true}).count
			t.Logf("PROVIDE_IDENTIFIER raw=%d prose=%d", raw, prose)
			if raw == 0 {
				t.Fatal("native identifier control has no raw grammar derivation")
			}
			if prose == 0 {
				t.Errorf("provide identifier lost its grammar derivation: %s", source)
			}
			if grammarProvideKeywordHeadAt(lab.g, tokens, 0) {
				t.Errorf("ordinary identifier selected the provide head: %s", source)
			}
		})
	}
	for _, source := range []string{
		"provide K {}",
		"provide K = 1, L {}",
		"provide K = { n: 1 } {}",
		"provide (K\n) {}",
		"provide K {",
	} {
		if !grammarProvideKeywordHeadAt(lab.g, grammarLexSource(source), 0) {
			t.Errorf("valid provider head missing its cover derivation: %s", source)
		}
	}
	for _, source := range []string{
		"provide K\n{}", "provide\nK {}", "provide K = {}",
		"provide K, L\n{}", "provide K + {}", "provide is M\n{}",
	} {
		if grammarProvideKeywordHeadAt(lab.g, grammarLexSource(source), 0) {
			t.Errorf("incomplete provider head gained a cover derivation: %s", source)
		}
	}
	for _, source := range []string{
		"effect function f() { provide K {} }",
		"effect function f() { provide K = { n: 1 } { return 1; } }",
		"effect function f() { provide K = 1, L { return 1; } }",
	} {
		if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
			t.Errorf("real provide statement lost its grammar derivation: %s: %s", source, detail)
		}
	}
	const independent = "provide; const b = x is 1 + 1;"
	if mismatch, _ := grammarAdmissionMismatch(independent); !mismatch {
		t.Fatal("provide keyword lookahead hid an independent gap")
	}
}

func TestGrammarAdmissionProvideIdentifierRegression(t *testing.T) {
	TestGrammarAdmissionProvideHeadQuoted(t)
	w := NewWorkspace(t)
	for _, source := range grammarProvideIdentifierSources {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("ordinary provide identifier gained syntax rejection: %v", result.Diagnostics)
				}
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("ordinary provide identifier became an admission mismatch")
			}
		})
	}
	t.Run("line-break-before-brace", func(t *testing.T) {
		// The admission implication permits a compiler rejection. If this
		// source is accepted, its complete grammar derivation is required.
		const source = "provide is M\n{}"
		checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
	})
	t.Run("keyed-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:provide-identifier-head\nprovide is is is is as join\n[\n]"))
		if source != grammarProvideIdentifierSources[0] {
			t.Fatalf("provide identifier witness drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
	t.Run("keyed-mutation", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:asserted-is-expression\n\xa5000\xa51@000110"))
		if source != grammarProvideIdentifierSources[0] {
			t.Fatalf("provide keyword mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
}
