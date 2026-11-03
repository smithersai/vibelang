package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

// The oracle is Appendix A's grammar, not the current compiler's parse.
// Parentheses terminate the CatchHead restriction; concise arrow bodies own
// their logical operators. Closed handlers admit neither binary nor postfix
// continuations without parentheses around the complete caught expression.
var catchPrecedenceQuotes = []string{
	"CatchHead = ClosedCatchExpression | BitwiseORExpression",
	"can't be mixed with `??`, `||` or `&&` without parentheses",
	"Any other handler is a closed expression, after which only another `catch` or a lower-precedence operator can follow.",
	"a `catch` handler that is not a plain or `effect` arrow or function expression:",
}

func TestCatchPrecedenceQuoted(t *testing.T) {
	for _, quote := range catchPrecedenceQuotes {
		r3Quoted(t, "900-appendices.md", quote)
	}
}

func FuzzCatchPrecedence(f *testing.F) {
	startShortBudget(f)
	for _, quote := range catchPrecedenceQuotes {
		r3Quoted(f, "900-appendices.md", quote)
	}
	keys := []string{"mixed-head", "grouped-head", "grouped-catch", "arrow-body", "closed-logical", "closed-member", "closed-index", "closed-call", "grouped-result", "nonliteral-handler"}
	for _, key := range keys {
		f.Add([]byte(key))
		for i := byte(0); i < 6; i++ {
			f.Add(append([]byte(key+":"), i, i+1, i+2, i+3))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		key := keys[0]
		tail := data
		if len(data) > 0 {
			key = keys[int(data[0])%len(keys)]
			tail = data[1:]
		}
		for _, candidate := range keys {
			if string(data) == candidate {
				key = candidate
				tail = nil
				break
			}
			if rest, ok := strings.CutPrefix(string(data), candidate+":"); ok {
				key = candidate
				tail = []byte(rest)
				break
			}
		}
		pick := func(n int) int {
			if len(tail) == 0 {
				return 0
			}
			v := int(tail[0]) % n
			tail = tail[1:]
			return v
		}
		op := []string{"??", "||", "&&"}[pick(3)]
		handler := []string{"() => 1", "effect () => 1", "(() => 1)", "function () { return 1 }", "effect function () { return 1 }"}[pick(5)]
		trivia := []string{" ", " /* boundary */ ", "\n"}[pick(3)]
		parens := func(s string) string {
			depth := 1 + pick(4)
			return strings.Repeat("(", depth) + s + strings.Repeat(")", depth)
		}
		expr := ""
		want := false
		nonliteral := false
		switch key {
		case "mixed-head":
			expr = "b " + op + " a" + trivia + "catch " + handler
			want = true
		case "grouped-head":
			expr = parens("b "+op+" a") + trivia + "catch " + handler
		case "grouped-catch":
			expr = "b " + op + " " + parens("a catch "+handler)
		case "arrow-body":
			expr = "a catch () => b " + op + " 1"
		case "closed-logical":
			expr = "a catch " + parens("() => 1") + trivia + op + " 2"
			want = true
		case "closed-member":
			expr = "a catch " + parens("function () { return 1 }") + trivia + ".call(null)"
			want = true
		case "closed-index":
			expr = "a catch function () { return [1] }" + trivia + "[0]"
			want = true
		case "closed-call":
			expr = "a catch " + parens("function () { return 1 }") + trivia + []string{"()", "?.()"}[pick(2)]
			want = true
		case "nonliteral-handler":
			expr = "a catch " + []string{"effect { return 9 }", "(effect { return 9 })", "throw new Error(\"failure\")", "(throw new Error(\"failure\"))", "throw problem()"}[pick(5)]
			nonliteral = true
		case "grouped-result":
			expr = parens("a catch function () { return [1] }") + trivia + "[0]"
		}
		source := "effect function f() { return " + expr + " }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		ds := file.Diagnostics()
		if nonliteral {
			for _, d := range ds {
				if d.Source() == "EK" && d.Code() == 512 {
					Gap(t, "FuzzCatchPrecedence", key, "Appendix B assigns nonliteral handlers EK0509; a generated arrow is not a source function literal: %v", ds)
				}
			}
		} else if want {
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 512 {
				Gap(t, "FuzzCatchPrecedence", key, "Appendix A requires one EK0512; got %v:\n%s", ds, source)
			}
		} else if len(ds) != 0 {
			Gap(t, "FuzzCatchPrecedence", key, "Appendix A admits this grouping; got %v:\n%s", ds, source)
		}
	})
}
