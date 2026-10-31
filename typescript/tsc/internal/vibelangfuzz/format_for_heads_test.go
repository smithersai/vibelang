package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

var formatForHeadQuotes = []struct{ chapter, quote string }{
	{"004-match.md", "In `for (init; test; update)`, a binding from `init` belongs to the loop head"},
	{"007-tooling.md", "It preserves every line-sensitive and parenthesis-sensitive rule in [Appendix A](900-appendices.md#appendix-a-grammar): never insert or remove a line break or parentheses that change the parse."},
	{"007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent."},
}

func requireFormatForHeadQuotes(t testing.TB) {
	t.Helper()
	for _, rule := range formatForHeadQuotes {
		chapter, quote := rule.chapter, rule.quote
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer contains %q", chapter, quote)
		}
	}
}

func TestFormatForHeadsQuoted(t *testing.T) { requireFormatForHeadQuotes(t) }

// The keys keep classic for init/test/update/declaration and iterable-head
// forms stable. Mutations vary grouping, pattern shape, trivia and bracing.
// Binding runtime semantics remain in the VIP-7 differential target.
func FuzzFormatForHeads(f *testing.F) {
	startShortBudget(f)
	requireFormatForHeadQuotes(f)
	for _, key := range []string{"init", "test", "update", "declaration", "of", "in"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(3))
		f.Add(key, uint8(63))
		f.Add(key, uint8(96))
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		pattern := []string{"let n", "{ value: let n }", "[let n]", "let n and if (n > 0)"}[mode%4]
		if mode&64 != 0 {
			pattern = "{\n  value: let n\n}"
		}
		expr := "src is " + pattern
		if mode&4 != 0 {
			expr = "(" + expr + ")"
		}
		if mode&8 != 0 {
			expr = strings.Replace(expr, " is ", " /* subject */ is /* pattern */ ", 1)
		}
		var head string
		switch key {
		case "test":
			head = "; " + expr + "; "
		case "update":
			head = "; ok; " + expr
		case "declaration":
			head = "const ok = " + expr + "; ok; "
		case "of":
			head = "const item of (" + expr + ") ? items : []"
		case "in":
			head = "const item in (" + expr + ") ? object : {}"
		default:
			key, head = "init", expr+"; n > 0; n--"
		}
		body := "seen.push(() => n)"
		if mode&16 != 0 {
			body = "{ " + body + " }"
		}
		source := fmt.Sprintf("function f(src: any) { for (%s) %s }\n", head, body)
		if err := toolsSyntaxError("main.vibe", source); err != "" {
			t.Fatalf("invalid generator: %s\n%s", err, source)
		}
		host := formatter
		if mode&32 != 0 {
			host = func(text string) (string, error) {
				text, err := formatter(text)
				return strings.ReplaceAll(text, " >= ", "\n      >= "), err
			}
		}
		once, err := vibelangfmt.Format("main.vibe", source, host)
		if err != nil {
			Gap(t, "FuzzFormatForHeads", "for-head:"+key, "valid for-head pattern refused: %v\n%s", err, source)
		}
		if err := vibelangfmt.SameProgram(source, once); err != nil {
			Gap(t, "FuzzFormatForHeads", "program:"+key, "%v\n%s\n%s", err, source, once)
		}
		twice, err := vibelangfmt.Format("main.vibe", once, host)
		if err != nil || twice != once {
			Gap(t, "FuzzFormatForHeads", "idempotence:"+key, "%v\n%s\n%s", err, once, twice)
		}
	})
}
