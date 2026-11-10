package vibelangfuzz

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const grammarPatternMemberQuote = "PatternMatchingMemberExpression[?Yield, ?Await] `[` Expression[+In, ?Yield, ?Await] `]`"

func TestGrammarAdmissionPatternMemberQuoted(t *testing.T) {
	text := SpecText("../vips/tc39-pattern-matching/spec.emu")
	for _, quote := range []string{
		grammarPatternMemberQuote,
		"MatchPattern[?Yield, ?Await] `and` MatchPattern[?Yield, ?Await]",
		"MatchPattern[?Yield, ?Await] `or` MatchPattern[?Yield, ?Await]",
		"`not` MatchPattern[?Yield, ?Await]",
	} {
		if !strings.Contains(text, quote) {
			t.Fatalf("pinned matcher production changed: %s", quote)
		}
	}
}

// A bare matcher member can continue through a newline, just as an ordinary
// member can. An empty/elided/spread array is not the required Expression.
func grammarPatternMemberLineBreak(source string, forms []parser.VibeSyntax) bool {
	for _, form := range forms {
		start, end := form.Word.End(), form.Right.End()
		if form.Kind != parser.VibeSyntaxIs || start < 0 || end <= start || end > len(source) {
			continue
		}
		pattern := grammarLexSource(source[start:end])

		whole := grammarLexSource(source[start:])
		// The corrected parser includes a continued access in Right. Keep its
		// original key as well as the old split-form reading below.
		for i, tok := range pattern {
			if tok.text != "[" || !tok.nl || !grammarPatternMemberTail(pattern[:i]) || i+1 >= len(whole) {
				continue
			}
			if slices.Contains([]string{"]", ",", "..."}, whole[i+1].text) {
				return true
			}
			depth := 0
			for j := i; j < len(whole); j++ {
				switch whole[j].text {
				case "[", "(", "{":
					depth++
				case "]", ")", "}":
					depth--
				}
				if depth == 0 {
					if j > i && whole[j-1].text == "," {
						return true
					}
					break
				}
			}
		}
		if !grammarPatternMemberTail(pattern) || len(whole) <= len(pattern)+1 {
			continue
		}
		tail := whole[len(pattern):]
		if tail[0].text == "[" && tail[0].nl && (tail[1].text == "]" || tail[1].text == "," || tail[1].text == "...") {
			return true
		}
		// An Expression has no trailing comma, so `[ a , ]` is no member access.
		depth := 0
		for k, tok := range tail {
			switch tok.text {
			case "[", "(", "{":
				depth++
			case "]", ")", "}":
				depth--
			}
			if depth == 0 {
				if tail[0].text == "[" && tail[0].nl && k > 0 && tail[k-1].text == "," {
					return true
				}
				break
			}
		}
	}
	return false
}

// Combined patterns may end in a member whose computed access continues.
// Only operators outside nested patterns introduce another possible member;
// property names and parenthesized/extractor tails keep their own boundary.
func grammarPatternMemberTail(ts []grammarToken) bool {
	if grammarPurePatternMember(ts) {
		return true
	}
	depth := 0
	for i, tok := range ts {
		switch tok.text {
		case "(", "[", "{":
			depth++
		case ")", "]", "}":
			depth--
		case "and", "or", "not":
			if depth == 0 && tok.kind == 'w' && (i == 0 || ts[i-1].text != ".") && grammarPurePatternMember(ts[i+1:]) {
				return true
			}
		}
	}
	return false
}

func grammarPurePatternMember(ts []grammarToken) bool {
	// A relational pattern's operand is the same member expression.
	if len(ts) > 0 && slices.Contains([]string{"<", "<=", ">", ">=", "==", "===", "!=", "!=="}, ts[0].text) {
		ts = ts[1:]
	}
	if len(ts) == 0 || ts[0].kind != 'w' || ts[0].text == "true" || ts[0].text == "false" || ts[0].text == "null" {
		return false
	}
	at := 1
	for at < len(ts) {
		switch ts[at].text {
		case ".":
			at++
			if at < len(ts) && ts[at].text == "#" {
				at++
			}
			if at >= len(ts) || ts[at].kind != 'w' {
				return false
			}
			at++
		case "[":
			depth := 1
			for at++; at < len(ts) && depth > 0; at++ {
				switch ts[at].text {
				case "[":
					depth++
				case "]":
					depth--
				}
			}
			if depth != 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func TestGrammarAdmissionPatternMemberKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"is is join\n[ ]":            true,
		"x is C\n[];":                true,
		"const b = x is ns.C\n[];":   true,
		"x is C[key]\n[,];":          true,
		"x is C\n[...items];":        true,
		"x is C\r\n[];":              true,
		"x is C /*\n*/ [];":          true,
		"x is C[];":                  false,
		"x is C\n[key];":             false,
		"x is C;\n[];":               false,
		"x is [let a]\n[];":          false,
		"x is (C)\n[];":              false,
		"x is C()\n[];":              false,
		"const is = C; value\n[];":   false,
		"value.is\n[];":              false,
		"const s = \"x is C\\n[]\";": false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:pattern-member-line-break") != want {
			t.Errorf("key=%q,want member line break=%v: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionPatternMemberRegression(t *testing.T) {
	TestGrammarAdmissionPatternMemberQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"is is join\n[ ]",
		"x is C\n[];",
		"const b = x is ns.C\n[];",
		"x is C[key]\n[,];",
		"x is C\n[...items];",
		"x is y\n[ [ ] , ]",
		"x is > y\n[ ]",
		"is is < and\n[ ]",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("computed member access needs an expression: %v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{"x is C;\n[];", "x is C[key];", "x is C\n[key];", "x is C[];"} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or rejected control became a mismatch: %s", source)
		}
	}
}

func TestGrammarAdmissionPatternMemberLogicalKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"is is is and join\n[ ]":                true,
		"x is C and D\n[];":                     true,
		"x is C or D\n[];":                      true,
		"x is not C\n[];":                       true,
		"x is C and not ns.D[key]\n[...items];": true,
		"x is C and ns.D[key]\n[...items];":     true,
		"x is let a and C\n[,];":                true,
		"x is (C or D) and E\n[];":              true,
		"x is C and ns.and\n[];":                true,
		"x is C and not.foo\n[];":               true,
		"x is C and D;\n[];":                    false,
		"x is C and D\n[key];":                  false,
		"x is C and (D)\n[];":                   false,
		"x is C and P()\n[];":                   false,
		"(x is C and D)\n[];":                   false,
		"x is not let a\n[];":                   false,
		"x is [C and D]\n[];":                   false,
		"x is { a: C and D }\n[];":              false,
		"const s = \"x is C and D\\n[]\";":      false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:pattern-member-line-break") != want {
			t.Errorf("key=%q,want member line break=%v: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionPatternMemberLogicalRegression(t *testing.T) {
	TestGrammarAdmissionPatternMemberQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"is is is and join\n[ ]",
		"x is C and D\n[];",
		"x is C or D\n[];",
		"x is not C\n[];",
		"x is C and ns.D[key]\n[...items];",
		"x is let a and C\n[,];",
		"x is (C or D) and E\n[];",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				result, err := w.Compile(context.Background(), Single(source))
				if err != nil {
					t.Fatal(err)
				}
				t.Fatalf("combined computed member access needs an expression: %v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"x is C and D;\n[];",
		"x is C and D\n[key];",
		"x is C and (D)\n[];",
		"x is C and P()\n[];",
		"(x is C and D)\n[];",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or rejected control became a mismatch: %s", source)
		}
	}
	// Different combinators at one level already receive syntax rejection.
	// Keep that independent error distinct from the member continuation gap.
	mixed := "x is C and not ns.D[key]\n[...items];"
	result, err := w.Compile(context.Background(), Single(mixed))
	if err != nil {
		t.Fatal(err)
	}
	rejected := false
	for _, d := range result.Diagnostics {
		rejected = rejected || IsEK(d) && d.Code() == 707
	}
	if !rejected || grammarAdmissionVerdict(t, w, mixed) {
		t.Fatalf("mixed combinator control lost EK0707 syntax rejection: %v", result.Diagnostics)
	}
}
