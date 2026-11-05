package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarAssertedIsQuote = "RelationalExpression [no LineTerminator here] `is` MatchPattern"

func TestGrammarAdmissionAssertedIsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) ||
		!strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), grammarAssertedIsQuote) {
		t.Fatal("Appendix A's TypeScript inheritance or pinned is production changed; review assertion continuations")
	}
}

// An is test remains an expression, including when a native erased assertion
// follows it. A newline before an array type suffix does not start an array
// expression, and assertions do not extend the pattern's member-access tail.
func TestGrammarAdmissionAssertedIs(t *testing.T) {
	TestGrammarAdmissionAssertedIsQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"is is is as join\n[ ]",
		"const b = x is M as boolean;",
		"const b = x is M satisfies boolean;",
		"const b = x is M as T[];",
		"const b = x is M as T\n[];",
		"const b = x is M satisfies T\n[];",
		"const b = x is M as\nT[];",
		"const b = x is M as unknown as T[];",
		"const b = x is M as unknown satisfies T;",
		"const b = x is M satisfies T as unknown;",
		"const b = x is ns.M as boolean;",
		"const b = x is M[key] as boolean;",
		"const b = x is M(let value) as boolean;",
		"const b = x is > 1 as boolean;",
		"const b = x is not M satisfies boolean;",
		"const b = x is M and N as boolean;",
		"const b = x is 1 or 2 as boolean;",
		"const b = x is [1] as boolean;",
		"const b = (x is M as boolean);",
		"const b = x is M as boolean && ok;",
		"const b = x is M satisfies boolean ? 1 : 2;",
	} {
		t.Run(source, func(t *testing.T) {
			if lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}).count == 0 {
				t.Errorf("inherited assertion after an is test has no derivation: %s", source)
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Errorf("an asserted is expression became undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"const b = x is M as;",
		"const b = x is M satisfies;",
		"const b = x is M\nas T;",
		"const b = x is M\nsatisfies T;",
	} {
		if lab.read(lab.g, grammarLexSource(source), grammarParseMode{}).count != 0 {
			t.Errorf("an incomplete or line-separated assertion derived: %s", source)
		}
	}
	for _, source := range []string{
		"const b = (x is M) as boolean;",
		"const b = x is M.as;",
		"const b = x is as;",
		"const b = x is M;",
	} {
		if lab.read(lab.g, grammarLexSource(source), grammarParseMode{}).count == 0 {
			t.Errorf("an existing pattern or grouped assertion lost its derivation: %s", source)
		}
	}
}

func TestGrammarAdmissionAssertedIsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"is is is as join\n[ ]",
		"const b = x is M as T\n[];",
		"const b = x is M satisfies T;",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("native assertion continuation still reported as an admission mismatch: %s", source)
		}
	}
	const source = "is is is as join\n[ ]"
	key, got := grammarAdmissionInput([]byte("key:asserted-is-expression\n" + source))
	if key != "admission:asserted-is-expression" || got != source {
		t.Fatalf("keyed assertion witness changed: key=%q source=%q", key, got)
	}
}
