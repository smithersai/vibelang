package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const catchParenthesesTarget = "FuzzCatchParenthesizedHandlers"

var catchParenthesesQuotes = []string{
	"Either kind may be parenthesized:",
	"a member access or call can't attach to the handler",
}

func catchParenthesesChapter(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range catchParenthesesQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}

func TestCatchParenthesizedHandlersQuoted(t *testing.T) {
	catchParenthesesChapter(t)
}

// Admission and contextual typing come from the chapter's function-literal
// grammar, not today's AST. Runtime Exit comparison stays in the existing
// vip05.catch-parenthesized-arrow differential construct.
func FuzzCatchParenthesizedHandlers(f *testing.F) {
	startShortBudget(f)
	catchParenthesesChapter(f)
	keys := []string{"plain", "plain-comment", "effect", "effect-comment"}
	for _, key := range keys {
		f.Add([]byte(key))
		for depth := range 4 {
			f.Add(append([]byte(key+":"), byte(depth), byte(7-depth)))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		tail := data
		if len(data) > 0 {
			choice = int(data[0]) % len(keys)
			tail = data[1:]
		}
		for i, key := range keys {
			if string(data) == key {
				choice, tail = i, nil
				break
			}
			if rest, ok := strings.CutPrefix(string(data), key+":"); ok {
				choice, tail = i, []byte(rest)
				break
			}
		}
		depth, delta := 1, 4
		if len(tail) > 0 {
			depth += int(tail[0]) % 4
		}
		if len(tail) > 1 {
			delta += int(tail[1]) % 8
		}
		handler := fmt.Sprintf("(e: number) => e + %d", delta)
		if choice >= 2 {
			handler = fmt.Sprintf("effect (e: number) => { return try Effect.succeed(e + %d) }", delta)
		}
		for range depth {
			if choice%2 == 1 {
				handler = "(/* before */ " + handler + " /* after */)"
			} else {
				handler = "(" + handler + ")"
			}
		}
		source := func(suffix string) string {
			return "import { Effect } from \"effect\";\nexport effect function main() { const value: number = Effect.fail(3) catch " + handler + suffix + "; return value }"
		}
		compile := func(text string) []string {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			return errors
		}
		key := keys[choice]
		if errors := compile(source("")); len(errors) != 0 {
			Gap(t, catchParenthesesTarget, "admit:"+key, "chapter 2 admits a parenthesized handler with its result context:\n%s\n%s", source(""), strings.Join(errors, "\n"))
			return
		}
		suffixes := []string{"()", ".call(null)", "[0]"}
		suffix := suffixes[(depth+delta)%len(suffixes)]
		if errors := compile(source(suffix)); len(errors) == 0 {
			Gap(t, catchParenthesesTarget, "suffix:"+key, "chapter 2 forbids a call/member suffix on the handler:\n%s", source(suffix))
			return
		}
		ExpectPending(t, catchParenthesesTarget, "admit:"+key)
		ExpectPending(t, catchParenthesesTarget, "suffix:"+key)
		ExpectPending(t, catchParenthesesTarget, specCorpusKey(t))
	})
}
