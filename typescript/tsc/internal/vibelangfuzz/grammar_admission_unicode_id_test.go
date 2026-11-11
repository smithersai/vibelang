package vibelangfuzz

import (
	"fmt"
	"testing"
	"unicode"
)

func grammarUnicodePropertyRunes(table *unicode.RangeTable) []rune {
	var runes []rune
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if unicode.Is(table, r) {
			runes = append(runes, r)
		}
	}
	return runes
}

// Appendix A inherits TypeScript's IdentifierName. ID_Start includes letter
// numbers and Other_ID_Start; ID_Continue also includes Other_ID_Continue.
func TestGrammarLexUnicodeIDProperties(t *testing.T) {
	assertWord := func(t *testing.T, name string) {
		t.Helper()
		tokens := grammarLexSource(name)
		if len(tokens) != 1 || tokens[0].kind != 'w' || tokens[0].text != name {
			t.Fatalf("identifier split: %q -> %+v", name, tokens)
		}
	}
	for _, r := range grammarUnicodePropertyRunes(unicode.Other_ID_Start) {
		t.Run(fmt.Sprintf("start-%04X", r), func(t *testing.T) {
			assertWord(t, string(r)+"x")
			assertWord(t, "x"+string(r)+"y")
		})
	}
	for _, r := range grammarUnicodePropertyRunes(unicode.Other_ID_Continue) {
		t.Run(fmt.Sprintf("continue-%04X", r), func(t *testing.T) {
			assertWord(t, "x"+string(r)+"y")
			// The Other_ID_Continue additions are not identifier starts.
			tokens := grammarLexSource(string(r) + "x")
			if len(tokens) == 1 && tokens[0].kind == 'w' {
				t.Fatalf("continuation-only rune starts a name: U+%04X", r)
			}
		})
	}
	assertWord(t, "Ⅰx")
	assertWord(t, "xⅠy")
}

func TestGrammarAdmissionUnicodeIDProperties(t *testing.T) {
	w := NewWorkspace(t)
	for _, r := range []rune{
		'ᢅ', 'ᢆ', '℘', '℮', '゛', '゜', 'Ⅰ',
		'·', '·', '፩', '፱', '᧚',
	} {
		// Stock TypeScript 5.9.3 accepts all of these continuations.
		name := "a" + string(r) + "b"
		source := "const " + name + " = 1; export const v = " + name
		t.Run(fmt.Sprintf("%04X", r), func(t *testing.T) {
			if grammarArrowSafeSyntaxRejected(t, w, source) {
				t.Fatalf("inherited identifier rejected as syntax: %q", source)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("identifier still reads as an admission gap: %q", source)
			}
		})
	}
}
