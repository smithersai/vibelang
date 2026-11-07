package vibelangfuzz

import (
	"strings"
	"testing"
)

// Removing only the line terminator before a second bang must restore a full
// Appendix A derivation. Delimiter scopes keep nested operands independent.
func grammarSecondBangLineBreak(ts []grammarToken) bool {
	type scope struct {
		open     string
		lastBang int
	}
	scopes := []scope{{lastBang: -1}}
	marks := map[int]bool{}
	for i, tok := range ts {
		if tok.kind == 's' || tok.kind == 't' {
			continue
		}
		at := len(scopes) - 1
		switch tok.text {
		case "(", "[", "{":
			scopes = append(scopes, scope{tok.text, -1})
		case ")", "]", "}":
			if at == 0 || scopes[at].open != map[string]string{")": "(", "]": "[", "}": "{"}[tok.text] {
				return false
			}
			scopes = scopes[:at]
		case ";", ",", "=", "|", "&", ":", "?", "=>":
			scopes[at].lastBang = -1
		case "!":
			last := scopes[at].lastBang
			if tok.nl && last >= 0 && last != i-1 && grammarInTypeAlias(ts, i) {
				marks[i] = true
			}
			scopes[at].lastBang = i
		}
	}
	if len(marks) == 0 {
		return false
	}
	lab, err := admissionLab()
	if err != nil {
		return false
	}
	mode := grammarParseMode{prose: true, names: true}
	if lab.read(lab.g, ts, mode).count != 0 {
		return false
	}
	normalized := append([]grammarToken(nil), ts...)
	for i := range marks {
		normalized[i].nl = false
	}
	return lab.read(lab.g, normalized, mode).count != 0
}

func TestGrammarAdmissionSecondBangQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarParenthesizedEffectQuote) {
		t.Fatal("EffectType line-terminator production changed")
	}
}

var grammarSecondBangSources = []string{
	"{ type T = (\nnumber ! string\n! 1 )\nboolean }",
	"type T = (number!string\n!boolean);",
	"type T = ((number!string\n!boolean));",
	"type T = (number!(string | boolean)\n!1);",
	"type T = (number!string\n!boolean)[];",
	"type T = (number!string\n!boolean)[K];",
	"type T = [number, (number!string\n!boolean)];",
	"type T = { value: (number!string\n!boolean) };",
	"type T = () => (number!string\n!boolean);",
	"type T = (number!string\n!{ value: number });",
	"type T = (number!string /* newline */\r\n!boolean);",
	"type T = (number!string\n!boolean); type U = (string!number\n!boolean);",
}

func TestGrammarAdmissionSecondBangKeys(t *testing.T) {
	for _, source := range grammarSecondBangSources {
		if got := grammarAdmissionForm(source); got != "admission:effect-type-line-break" {
			t.Errorf("second bang lost its existing line-break key: got %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"type T = (number!string!boolean);", "type T = (number!string);",
		"type T = (number!!);", "type T = (number!(string!boolean));",
		"type T = (number!string)\n!boolean;", "const x = (a! + b!);",
		"const x = (a!\n!b);", "type T = (number!string); const x = (a!\n!b);",
		"type T = ((number!string)\n!boolean);",
	} {
		if grammarSecondBangLineBreak(grammarLexSource(source)) {
			t.Errorf("independent or valid syntax entered the second-bang family: %s", source)
		}
	}
	const independent = "type T = (number!string\n!boolean); const b = x is 1 + 1;"
	if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
		t.Errorf("normalization hid an independent gap: %q", got)
	}
}

func TestGrammarAdmissionSecondBangRegression(t *testing.T) {
	TestGrammarAdmissionSecondBangQuoted(t)
	w := NewWorkspace(t)
	for _, source := range grammarSecondBangSources {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("recorded second-bang admission gap changed: %s", source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
