package vibelangfuzz

import "testing"

// Punctuators TypeScript rescans after a type, a template with a nested
// template in a substitution, and a signed exponent, each found by surveying
// the compiler cases the lab did not derive. The lexer keeps longest-match
// tokens; a program the first read refuses is read again with `>=` and a
// post-bang `!=` split.
func TestGrammarLexTemplateAndExponent(t *testing.T) {
	for _, c := range []struct {
		source string
		want   []string
	}{
		{"t`outer: ${t`inner`}`", []string{"t", "`outer: ${t`inner`}`"}},
		{"`a${ {b: `c`} }d`", []string{"`a${ {b: `c`} }d`"}},
		{"`a${\"}\"}b`", []string{"`a${\"}\"}b`"}},
		{"-1e-400", []string{"-", "1e-400"}},
		{"2E+3 + 1e5", []string{"2E+3", "+", "1e5"}},
		{"0xe-1", []string{"0xe", "-", "1"}},
		{"cafe\u0301 = caf\u00e9", []string{"cafe\u0301", "=", "caf\u00e9"}},
		{"a\u200db + x\u203fy", []string{"a\u200db", "+", "x\u203fy"}},
		{"\u0301x", []string{"\u0301", "x"}},
		{"a-1", []string{"a", "-", "1"}},
	} {
		var got []string
		for _, tok := range grammarLexSource(c.source) {
			got = append(got, tok.text)
		}
		if len(got) != len(c.want) {
			t.Errorf("lex %q = %q, want %q", c.source, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("lex %q = %q, want %q", c.source, got, c.want)
				break
			}
		}
	}
}

func TestGrammarRescannedTokens(t *testing.T) {
	for _, c := range []struct {
		source string
		want   []string
	}{
		{"x<T>= y", []string{"x", "<", "T", ">", "=", "y"}},
		{"Set<string>=> f", []string{"Set", "<", "string", ">", "=>", "f"}},
		{"number!!= 1", []string{"number", "!", "!", "=", "1"}},
		{"a >= b", []string{"a", ">", "=", "b"}},
	} {
		got, ok := grammarRescannedTokens(grammarLexSource(c.source))
		if !ok {
			t.Errorf("no split for %q", c.source)
			continue
		}
		var texts []string
		for _, tok := range got {
			texts = append(texts, tok.text)
		}
		if len(texts) != len(c.want) {
			t.Errorf("rescan %q = %q, want %q", c.source, texts, c.want)
			continue
		}
		for i := range texts {
			if texts[i] != c.want[i] {
				t.Errorf("rescan %q = %q, want %q", c.source, texts, c.want)
				break
			}
		}
	}
	if _, ok := grammarRescannedTokens(grammarLexSource("a != b; c > d")); ok {
		t.Error("a program with nothing to rescan reports a split")
	}
}
