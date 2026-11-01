package vibelangfuzz

import (
	"fmt"
	"slices"
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
	return []string{"if", "else", "while", "do", "for", "for-in", "for-of", "for-await", "for-concurrent", "for-try", "label", "for-of-if-head", "if-body-if-head"}
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
	if braced || native {
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

// R3 OPUS-2, approved detail245: a non-block statement body is an implicit
// fresh lexical home, exactly as if braces were written. The if HEAD inside
// that body belongs to this home too. Do not infer this rule from today's
// compiler. These are admission/name-visibility checks; the fresh-per-iteration
// Exit equivalence still belongs in a VIP-7 differential construct/campaign.
func FuzzReviewIsStatementHomes(f *testing.F) {
	startShortBudget(f)
	homes := reviewIsStatementHomes()
	for _, home := range homes {
		for flags := range uint8(4) {
			f.Add(home, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, home string, flags uint8) {
		TestReviewIsStatementHomesQuoted(t)
		if !slices.Contains(homes, home) {
			if home == "" {
				return
			}
			home = homes[int(home[0])%len(homes)]
		}
		flags %= 4
		braced, leak := flags&1 != 0, flags&2 != 0
		for _, native := range []bool{true, false} {
			source := reviewIsStatementHomeProgram(home, braced, leak, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check implicit statement home", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			missing, unexpected := false, false
			for _, diagnostic := range result.Diagnostics {
				if !IsEK(diagnostic) && diagnostic.Code() == 2304 && diagnostic.Pos() == strings.LastIndex(source, "cell") {
					missing = true
				} else if diagnostic.Category().Name() == "error" {
					unexpected = true
				}
			}
			matches := missing && !unexpected
			if !leak {
				matches = !HasError(result.Diagnostics)
			}
			if !matches {
				if native {
					t.Fatalf("invalid native braced lexical-home control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				key := fmt.Sprintf("%s:%d", home, flags)
				Gap(t, reviewIsStatementHomesTarget, key, "Chapter4 usual scopes plus approved detail245 require missing outside binding=%t, got %v\n%s", leak, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			if !native {
				ExpectPending(t, reviewIsStatementHomesTarget, fmt.Sprintf("%s:%d", home, flags))
				ExpectPending(t, reviewIsStatementHomesTarget, specCorpusKey(t))
			}
		}
	})
}
