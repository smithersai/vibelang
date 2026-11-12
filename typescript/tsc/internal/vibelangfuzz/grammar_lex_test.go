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
	i := 0
	// ECMAScript's HashbangComment: `#!` at the very start of the source runs
	// to the end of its line and is skipped like a comment, as TypeScript's
	// scanner does; anywhere else `#!` is TS18026 and lexes as written.
	if len(rs) >= 2 && rs[0] == '#' && rs[1] == '!' {
		for i < len(rs) && rs[i] != '\n' {
			i++
		}
	}
	for i < len(rs) {
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
		case r == '`':
			j = grammarTemplateEnd(rs, i)
			t.kind = 't'
		case r == '"' || r == '\'':
			for j < len(rs) && rs[j] != r {
				if rs[j] == '\\' {
					j++
				}
				j++
			}
			j++
			t.kind = 's'
		case r == '‹':
			for j < len(rs) && rs[j] != '›' {
				j++
			}
			j++
			t.kind = 'x'
		// ECMAScript's DecimalLiteral may start with `.` before a digit: `.5`.
		case r >= '0' && r <= '9' || r == '.' && grammarIsDecimalDigitAt(rs, i+1):
			// A DecimalLiteral's ExponentPart may carry a sign: `1e-400`, `2E+3`.
			// A hex, octal or binary literal has no exponent, and its e is a digit.
			decimal := !(r == '0' && i+1 < len(rs) && strings.ContainsRune("xXoObB", rs[i+1]))
			for j < len(rs) && (grammarIsWordRune(rs[j]) || rs[j] == '.' || decimal && (rs[j] == '+' || rs[j] == '-') && (rs[j-1] == 'e' || rs[j-1] == 'E') && grammarIsDecimalDigitAt(rs, j+1)) {
				j++
			}
			t.kind = 'n'
		case grammarIsWordRune(r) || r == '$' || r == '#' || grammarIsUnicodeEscapeAt(rs, i):
			// A `\uXXXX` or `\u{…}` escape is part of an identifier, as in
			// ECMAScript's IdentifierName; the word keeps its written form.
			for j = i; j < len(rs); {
				switch {
				case grammarIsWordRune(rs[j]) || rs[j] == '$' || j == i && rs[j] == '#' || j > i && grammarIsWordContinueRune(rs[j]):
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
		if t.kind == 'w' && strings.Contains(t.text, "\\u") {
			t.decoded = grammarDecodeEscapes(t.text)
		}
		out = append(out, t)
		i = j
	}
	return out
}

// grammarIsWordContinueRune reports a rune ECMAScript's IdentifierPart admits
// after the first: ID_Continue adds nonspacing and spacing marks (a combining
// acute in an NFD name), decimal digits and connector punctuation to
// ID_Start, plus Other_ID_Continue; the grammar adds ZWNJ and ZWJ.
// The word scanner separately admits ID_Start's letters, letter numbers and
// Other_ID_Start (for example the script capital P, U+2118).
func grammarIsWordContinueRune(r rune) bool {
	return r == '\u200c' || r == '\u200d' || unicode.In(r, unicode.Mn, unicode.Mc, unicode.Nd, unicode.Pc, unicode.Other_ID_Continue)
}

// grammarTemplateEnd returns the index after the template literal that opens
// at i. A `${` substitution runs to its matching `}` and may hold strings,
// braces and nested templates, as TemplateMiddle and TemplateTail scanning
// does; an unterminated template runs to the end.
func grammarTemplateEnd(rs []rune, i int) int {
	j := i + 1
	for j < len(rs) {
		switch {
		case rs[j] == '\\':
			j += 2
		case rs[j] == '`':
			return j + 1
		case rs[j] == '$' && j+1 < len(rs) && rs[j+1] == '{':
			j = grammarSubstitutionEnd(rs, j+2)
		default:
			j++
		}
	}
	return len(rs)
}

// grammarSubstitutionEnd returns the index after the `}` that closes the
// substitution whose expression starts at i.
func grammarSubstitutionEnd(rs []rune, i int) int {
	depth := 0
	j := i
	for j < len(rs) {
		switch {
		case rs[j] == '`':
			j = grammarTemplateEnd(rs, j)
		case rs[j] == '"' || rs[j] == '\'':
			q := rs[j]
			j++
			for j < len(rs) && rs[j] != q {
				if rs[j] == '\\' {
					j++
				}
				j++
			}
			j++
		case rs[j] == '{':
			depth++
			j++
		case rs[j] == '}':
			if depth == 0 {
				return j + 1
			}
			depth--
			j++
		default:
			j++
		}
	}
	return len(rs)
}

// grammarDecodeEscapes replaces each `\uXXXX` or `\u{…}` escape of a word
// with the code point it names, as ECMAScript's IdentifierName StringValue
// does; anything else stays written.
func grammarDecodeEscapes(word string) string {
	rs := []rune(word)
	var b strings.Builder
	for i := 0; i < len(rs); {
		n := grammarUnicodeEscapeLen(rs, i)
		if n == 0 {
			b.WriteRune(rs[i])
			i++
			continue
		}
		hex := string(rs[i+2 : i+n])
		hex = strings.TrimSuffix(strings.TrimPrefix(hex, "{"), "}")
		var cp rune
		for _, h := range hex {
			cp = cp*16 + rune(strings.IndexRune("0123456789abcdef", unicode.ToLower(h)))
		}
		b.WriteRune(cp)
		i += n
	}
	return b.String()
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

// An escaped word keeps its written text and records its decoded name, as
// ECMAScript's IdentifierName StringValue; a plain word records none.
func TestGrammarLexDecodedEscapes(t *testing.T) {
	for _, c := range []struct{ word, decoded string }{
		{"a\\u006ey", "any"}, {"\\u{69}n", "in"}, {"t\\u0061rget", "target"}, {"m\\u0065ta", "meta"}, {"\\u0069f", "if"}, {"plain", ""},
	} {
		tok := grammarLexSource(c.word)[0]
		if tok.text != c.word || tok.decoded != c.decoded {
			t.Errorf("lex %q = %q decoded %q, want decoded %q", c.word, tok.text, tok.decoded, c.decoded)
		}
	}
}
