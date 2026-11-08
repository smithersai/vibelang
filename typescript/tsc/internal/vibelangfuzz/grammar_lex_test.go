package vibelangfuzz

import (
	"strings"
	"testing"
	"unicode"
)

// grammarLexSource splits source text into the search's tokens: words, string,
// number and template literals, punctuators by longest match, and prose
// terminals written ‹Name›. Comments are skipped. It doesn't lex regular
// expressions, which the subset leaves out, and it never joins ">" ">",
// so type arguments close as TypeScript rescans them.
func grammarLexSource(src string) []grammarToken {
	var out []grammarToken
	rs := []rune(src)
	nl := false
	for i := 0; i < len(rs); {
		r := rs[i]
		switch {
		case r == '\n':
			nl = true
			i++
			continue
		case unicode.IsSpace(r):
			i++
			continue
		case r == '/' && i+1 < len(rs) && rs[i+1] == '/':
			for i < len(rs) && rs[i] != '\n' {
				i++
			}
			continue
		case r == '/' && i+1 < len(rs) && rs[i+1] == '*':
			j := i + 2
			for j+1 < len(rs) && !(rs[j] == '*' && rs[j+1] == '/') {
				if rs[j] == '\n' {
					nl = true
				}
				j++
			}
			i = j + 2
			continue
		}
		t := grammarToken{nl: nl}
		nl = false
		j := i + 1
		switch {
		case r == '"' || r == '\'' || r == '`':
			for j < len(rs) && rs[j] != r {
				if rs[j] == '\\' {
					j++
				}
				j++
			}
			j++
			t.kind = 's'
			if r == '`' {
				t.kind = 't'
			}
		case r == '‹':
			for j < len(rs) && rs[j] != '›' {
				j++
			}
			j++
			t.kind = 'x'
		// ECMAScript's DecimalLiteral may start with `.` before a digit: `.5`.
		case r >= '0' && r <= '9' || r == '.' && grammarIsDecimalDigitAt(rs, i+1):
			for j < len(rs) && (grammarIsWordRune(rs[j]) || rs[j] == '.') {
				j++
			}
			t.kind = 'n'
		case grammarIsWordRune(r) || r == '$' || r == '#' || grammarIsUnicodeEscapeAt(rs, i):
			// A `\uXXXX` or `\u{…}` escape is part of an identifier, as in
			// ECMAScript's IdentifierName; the word keeps its written form.
			for j = i; j < len(rs); {
				switch {
				case grammarIsWordRune(rs[j]) || rs[j] == '$' || j == i && rs[j] == '#':
					j++
				case grammarIsUnicodeEscapeAt(rs, j):
					j += grammarUnicodeEscapeLen(rs, j)
				default:
					goto word
				}
			}
		word:
			t.kind = 'w'
		default:
			t.kind = 'p'
			for _, p := range grammarPunctuators {
				// OptionalChainingPunctuator is `?.` [lookahead ∉ DecimalDigit]:
				// `a?.5:1` is a conditional expression.
				if p == "?." && grammarIsDecimalDigitAt(rs, i+2) {
					continue
				}
				if strings.HasPrefix(string(rs[i:min(len(rs), i+4)]), p) {
					j = i + len([]rune(p))
					break
				}
			}
		}
		j = min(j, len(rs))
		t.text = string(rs[i:j])
		out = append(out, t)
		i = j
	}
	return out
}

// grammarIsDecimalDigitAt reports a decimal digit at i.
func grammarIsDecimalDigitAt(rs []rune, i int) bool {
	return i < len(rs) && rs[i] >= '0' && rs[i] <= '9'
}

// grammarIsUnicodeEscapeAt reports a `\uXXXX` or `\u{…}` escape at i.
func grammarIsUnicodeEscapeAt(rs []rune, i int) bool {
	return grammarUnicodeEscapeLen(rs, i) > 0
}

// grammarUnicodeEscapeLen is the length of the escape at i, or 0.
func grammarUnicodeEscapeLen(rs []rune, i int) int {
	if i+1 >= len(rs) || rs[i] != '\\' || rs[i+1] != 'u' {
		return 0
	}
	hex := func(r rune) bool { return r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F' }
	if i+2 < len(rs) && rs[i+2] == '{' {
		j := i + 3
		for j < len(rs) && hex(rs[j]) {
			j++
		}
		if j > i+3 && j < len(rs) && rs[j] == '}' {
			return j + 1 - i
		}
		return 0
	}
	if i+6 <= len(rs) && hex(rs[i+2]) && hex(rs[i+3]) && hex(rs[i+4]) && hex(rs[i+5]) {
		return 6
	}
	return 0
}

// grammarPunctuators, longest first.
var grammarPunctuators = []string{"...", "===", "!==", "**=", "??=", "&&=", "||=", "?.", "|>", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**"}

// grammarSpell writes tokens back as source: one space between tokens and a line
// break where a token has one before it.
func grammarSpell(toks []grammarToken) string {
	var b strings.Builder
	for i, t := range toks {
		if i > 0 {
			if t.nl {
				b.WriteByte('\n')
			} else {
				b.WriteByte(' ')
			}
		}
		b.WriteString(t.text)
	}
	return b.String()
}

// grammarTight writes tokens with no space between two punctuators, as people
// write "A!!" or "x!.y"; relexing it shows a token boundary the grammar
// depends on but the lexer doesn't keep.
func grammarTight(toks []grammarToken) string {
	var b strings.Builder
	for i, t := range toks {
		if i > 0 {
			switch {
			case t.nl:
				b.WriteByte('\n')
			case t.kind != 'p' || toks[i-1].kind != 'p':
				b.WriteByte(' ')
			}
		}
		b.WriteString(t.text)
	}
	return b.String()
}

// A leading-dot DecimalLiteral is one numeric token, and `?.` before a digit
// is `?` followed by that number.
func TestGrammarLexLeadingDotNumber(t *testing.T) {
	var got []string
	for _, tok := range grammarLexSource(".5 a?.5:1 a?.b ...xs .00e1") {
		got = append(got, string(tok.kind)+tok.text)
	}
	want := []string{"n.5", "wa", "p?", "n.5", "p:", "n1", "wa", "p?.", "wb", "p...", "wxs", "n.00e1"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("tokens %q, want %q", got, want)
	}
}
