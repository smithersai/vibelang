package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const grammarDeclarationNameQuote = "a declaration's or overload signature's: the enclosing context's"
const grammarExpressionNameQuote = "an expression's own name: the parameters of its body, [+Effect] included"

func TestGrammarAdmissionNameContextQuoted(t *testing.T) {
	text := SpecText(grammarAppendix)
	for _, quote := range []string{grammarDeclarationNameQuote, grammarExpressionNameQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Appendix A Name changed; review declaration/expression context: %s", quote)
		}
	}
}

// Names and formal parameters intentionally use different contexts. A nested
// plain callable resets the surrounding Effect context; expression names always
// use their own Effect context. These are derivation checks, not compiler flags.
func checkGrammarDeclarationNameContext(t *testing.T, data []byte) {
	t.Helper()
	if len(data) == 0 {
		return
	}
	pick := func(i, n int) int { return int(data[i%len(data)]) % n }
	name := []string{"fork", "join"}[pick(0, 2)]
	prefix := []string{"effect function ", "effect function* "}[pick(1, 2)]
	context := pick(2, 3)
	expression := pick(3, 2) != 0
	parameters := pick(4, 2) != 0
	source := prefix + name + "("
	if parameters {
		source += name
	}
	source += ") {}"
	if expression {
		source = "const value = " + source + ";"
	}
	switch context {
	case 1:
		source = "effect function outer() { " + source + " }"
	case 2:
		source = "effect function outer() { function inner() { " + source + " } }"
	}
	want := !expression && context != 1 && !parameters
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	got := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}).count != 0
	if got != want {
		t.Fatalf("Appendix A derivation=%v, want %v: %s", got, want, source)
	}
}

func TestGrammarAdmissionDeclarationNameContext(t *testing.T) {
	for name := byte(0); name < 2; name++ {
		for producer := byte(0); producer < 2; producer++ {
			for context := byte(0); context < 3; context++ {
				for expression := byte(0); expression < 2; expression++ {
					for parameter := byte(0); parameter < 2; parameter++ {
						input := []byte{name, producer, context, expression, parameter}
						t.Run(fmt.Sprint(input), func(t *testing.T) { checkGrammarDeclarationNameContext(t, input) })
					}
				}
			}
		}
	}
}

func FuzzGrammarDeclarationNameContext(f *testing.F) {
	startShortBudget(f)
	f.Add([]byte{0, 0, 0, 0, 0})
	f.Add([]byte{1, 1, 2, 0, 0})
	f.Add([]byte{0, 1, 1, 1, 1})
	f.Fuzz(func(t *testing.T, data []byte) { checkGrammarDeclarationNameContext(t, data) })
}

// Overload signatures inherit the declaration context too, but their parameters
// are Effect parameters. A bodyless expression is not introduced by this split.
func TestGrammarAdmissionOverloadNameContext(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for source, want := range map[string]bool{
		"effect function join(p): number!!;":                             true,
		"export effect function fork(p): number!!;":                      true,
		"effect function outer() { effect function join(p): number!!; }": false,
		"effect function join(join): number!!;":                          false,
	} {
		got := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}).count != 0
		if got != want {
			t.Errorf("derivation=%v, want %v: %s", got, want, source)
		}
	}
}
