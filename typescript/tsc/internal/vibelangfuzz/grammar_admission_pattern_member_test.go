package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const grammarPatternMemberQuote = "PatternMatchingMemberExpression[?Yield, ?Await] `[` Expression[+In, ?Yield, ?Await] `]`"

func TestGrammarAdmissionPatternMemberQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), grammarPatternMemberQuote) {
		t.Fatal("pinned computed matcher member production changed")
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
		if !grammarPurePatternMember(pattern) || len(whole) <= len(pattern)+1 {
			continue
		}
		tail := whole[len(pattern):]
		if tail[0].text == "[" && tail[0].nl && (tail[1].text == "]" || tail[1].text == "," || tail[1].text == "...") {
			return true
		}
	}
	return false
}

func grammarPurePatternMember(ts []grammarToken) bool {
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
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("member line-break witness gained syntax rejection: %v", result.Diagnostics)
				}
			}
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatal("computed member line break lost its observed admission gap")
			}
		})
	}
	for _, source := range []string{"x is C;\n[];", "x is C[key];", "x is C\n[key];", "x is C[];"} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or rejected control became a mismatch: %s", source)
		}
	}
}
