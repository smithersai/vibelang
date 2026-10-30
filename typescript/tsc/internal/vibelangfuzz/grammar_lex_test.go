package vibelangfuzz

import (
	"strings"
	"unicode"
)

// lexSource splits source text into the search's tokens: words, string,
// number and template literals, punctuators by longest match, and prose
// terminals written ‹Name›. Comments are skipped. It doesn't lex regular
// expressions, which the subset leaves out, and it never joins ">" ">",
// so type arguments close as TypeScript rescans them.
func lexSource(src string) []token {
	var out []token
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
		t := token{nl: nl}
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
		case r >= '0' && r <= '9':
			for j < len(rs) && (isWordRune(rs[j]) || rs[j] == '.') {
				j++
			}
			t.kind = 'n'
		case isWordRune(r) || r == '$' || r == '#':
			for j < len(rs) && (isWordRune(rs[j]) || rs[j] == '$') {
				j++
			}
			t.kind = 'w'
		default:
			t.kind = 'p'
			for _, p := range punctuators {
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

// punctuators, longest first.
var punctuators = []string{"...", "===", "!==", "**=", "??=", "?.", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "**"}

// spell writes tokens back as source: one space between tokens and a line
// break where a token has one before it.
func spell(toks []token) string {
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

// tight writes tokens with no space between two punctuators, as people
// write "A!!" or "x!.y"; relexing it shows a token boundary the grammar
// depends on but the lexer doesn't keep.
func tight(toks []token) string {
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
