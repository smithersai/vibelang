package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarParenthesizedEffectQuote = `EffectOperand [no LineTerminator here] "!" [no LineTerminator here] EffectOperand [no LineTerminator here] "!" [no LineTerminator here] EffectOperand`

func TestGrammarAdmissionParenthesizedEffectQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarParenthesizedEffectQuote) {
		t.Fatal("EffectType final-slot production changed; review the trailing-bang pending family")
	}
}

// A delimiter scope owns its bangs: a nested operand cannot supply the first
// bang of an enclosing type. Only a dangling bang before a closing parenthesis
// in an alias is considered. Removing just those bangs must restore a complete
// Appendix A derivation, so independent gaps retain their own keys.
func grammarParenthesizedEffectTrailingBang(ts []grammarToken) bool {
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
			if scopes[at].open == "(" && last >= 0 && last != i-1 && i+1 < len(ts) && ts[i+1].text == ")" && grammarInTypeAlias(ts, i) {
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
	normalized := make([]grammarToken, 0, len(ts)-len(marks))
	for i, tok := range ts {
		if !marks[i] {
			normalized = append(normalized, tok)
		}
	}
	return lab.read(lab.g, normalized, mode).count != 0
}

var grammarParenthesizedTrailingTypes = []string{
	"type T = (number!string!);",
	"{ type T = (\nnumber ! string ! )\nboolean }",
	"type T = ((number!string!));",
	"type T = (number!(string | boolean)!);",
	"type T = (number!string!)[];",
	"type T = (number!string!)[K];",
	"type T = [number, (number!string!)];",
	"type T = { value: (number!string!) };",
	"type T = () => (number!string!);",
	"type T = (number!string!); type U = (string!number!);",
}

func TestGrammarAdmissionParenthesizedEffectKeys(t *testing.T) {
	for _, source := range grammarParenthesizedTrailingTypes {
		if got := grammarAdmissionForm(source); got != "admission:effect-type-trailing-bang" {
			t.Errorf("parenthesized trailing bang lost its existing key: got %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"type T = (number!string);", "type T = (number!!);",
		"type T = (number!string!boolean);", "type T = (number!(string!!));",
		"type T = (number!!)!string;", "const x = (a! + b!);",
		"type T = (A!!, B!);", "type T = (A!B | C!);",
		"type T = (A!B!); const b = x is 1 + 1;",
	} {
		if grammarParenthesizedEffectTrailingBang(grammarLexSource(source)) {
			t.Errorf("separate or valid form entered parenthesized trailing-bang family: %s", source)
		}
	}
	const independent = "type T = (A!B!); const b = x is 1 + 1;"
	if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
		t.Errorf("normalization hid an independent gap: %q", got)
	}
}

func TestGrammarAdmissionParenthesizedEffectRegression(t *testing.T) {
	TestGrammarAdmissionParenthesizedEffectQuoted(t)
	w := NewWorkspace(t)
	for _, source := range grammarParenthesizedTrailingTypes {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("recorded final-slot admission gap changed: %s", source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// The original raw fuzz bytes must replay the same minimized program.
	key, source := grammarAdmissionInput([]byte("c20a20-"))
	if source != grammarParenthesizedTrailingTypes[1] {
		t.Fatalf("raw witness drifted: key=%q source=%q", key, source)
	}
	t.Run("raw-witness", func(t *testing.T) { checkGrammarAdmission(t, w, key, source) })
}
