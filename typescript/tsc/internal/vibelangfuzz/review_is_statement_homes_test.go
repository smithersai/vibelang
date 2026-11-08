package vibelangfuzz

import (
	"strings"
	"testing"
)

const reviewIsStatementHomesTarget = "FuzzReviewIsStatementHomes"
const reviewIsStatementHomeQuote = "Every other home follows the pinned explainer's rule that the usual binding scopes apply, with ECMAScript's environments:"

func TestReviewIsStatementHomesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), reviewIsStatementHomeQuote) {
		t.Fatalf("Chapter4 no longer says %q; update the approved detail245 oracle", reviewIsStatementHomeQuote)
	}
}

func reviewIsStatementHomes() []string {
	return []string{"if", "else", "while", "do", "for", "for-in", "for-of", "for-await", "for-concurrent", "for-try", "label", "for-of-if-head", "if-body-if-head", "nested-label-if", "nested-for-while"}
}

func reviewIsStatementHomeProgram(home string, braced, leak, native bool) string {
	body := "(a is let cell) && cell;"
	if native {
		body = "let cell = a; void cell;"
	}
	if home == "for-of-if-head" || home == "if-body-if-head" {
		body = "if (a is let cell) void cell;"
		if native {
			body = "let cell = a; void cell;"
		}
	}
	if braced {
		body = "{ " + body + " }"
	}
	var statement string
	switch home {
	case "if", "if-body-if-head":
		statement = "if (true) " + body
	case "else":
		statement = "if (false) {} else " + body
	case "while":
		statement = "while (false) " + body
	case "do":
		statement = "do " + body + " while (false);"
	case "for":
		statement = "for (let i = 0; i < 1; i++) " + body
	case "for-in":
		statement = "for (const item in { value: a }) " + body
	case "for-of", "for-of-if-head":
		statement = "for (const item of [a]) " + body
	case "for-await":
		statement = "for await (const item of [a]) " + body
	case "for-concurrent":
		if native {
			statement = "for (const item of [a]) " + body
		} else {
			statement = "for concurrent(1) (const item of [a]) " + body
		}
	case "for-try":
		if native {
			statement = "for (const item of [a]) " + body
		} else {
			statement = "for try (const item of Stream.make(a)) " + body
		}
	case "label":
		statement = "mark: " + body
	case "nested-label-if":
		statement = "mark: if (true) " + body
	case "nested-for-while":
		statement = "for (const item of [a]) while (false) " + body
	default:
		panic("unknown statement home")
	}
	if leak {
		statement += "\nvoid cell;"
	}
	prefix, returns := "", "void"
	if home == "for-await" {
		prefix, returns = "async ", "Promise<void>"
	} else if !native && (home == "for-concurrent" || home == "for-try") {
		prefix, returns = "effect ", "void!!"
	}
	return "export " + prefix + "function probe(a: unknown): " + returns + " {\n" + statement + "\n}\n"
}
