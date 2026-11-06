package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const fiberOperandTriviaQuote = "A line break after \x60fork\x60 or \x60join\x60 changes nothing, as after \x60await\x60: \x60join\x60 then \x60f\x60 on the next line joins \x60f\x60."

func TestFiberOperandTriviaQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), fiberOperandTriviaQuote) {
		t.Fatalf("chapter 2 no longer says %q", fiberOperandTriviaQuote)
	}
}

func FuzzFiberOperandTrivia(f *testing.F) {
	startShortBudget(f)
	owners := []string{"child", "in", "scoped", "detached"}
	heads := []string{"function", "arrow", "block", "method", "producer"}
	gaps := []string{"lf", "crlf", "ls", "ps", "block-comment", "line-comment"}
	for _, owner := range owners {
		for _, gap := range gaps {
			f.Add(owner + ":function:" + gap)
		}
	}
	for _, head := range heads[1:] {
		f.Add("scoped:" + head + ":line-comment")
	}
	f.Fuzz(func(t *testing.T, key string) {
		parts := strings.Split(key, ":")
		if len(parts) != 3 || !slices.Contains(owners, parts[0]) || !slices.Contains(heads, parts[1]) || !slices.Contains(gaps, parts[2]) {
			t.Skip()
		}
		owner, head, gap := parts[0], parts[1], parts[2]
		operator := map[string]string{"child": "fork", "in": "fork.in(s)", "scoped": "fork.scoped", "detached": "fork.detached"}[owner]
		trivia := map[string]string{"lf": "\n", "crlf": "\r\n", "ls": "\u2028", "ps": "\u2029", "block-comment": "/*\n*/", "line-comment": "// operand\n"}[gap]
		template := func(space string) string {
			body := "const f = " + operator + space + "e; return join" + space + "f"
			switch head {
			case "arrow":
				return "export const sample = effect (s, e) => { " + body + " }"
			case "block":
				return "export const sample = effect { const s = null, e = null; " + body + " }"
			case "method":
				return "export class C { effect sample(s, e) { " + body + " } }"
			case "producer":
				return "export effect function* sample(s, e) { const f = " + operator + space + "e; yield join" + space + "f }"
			default:
				return "export effect function sample(s, e) { " + body + " }"
			}
		}
		for _, render := range []func(string, vibelangmapper.FileContext) vibelangmapper.Projection{vibelangmapper.Project, vibelangmapper.Executable} {
			got, want := render(template(trivia), vibelangmapper.FileContext{}), render(template(" "), vibelangmapper.FileContext{})
			if len(want.Diagnostics) != 0 {
				t.Fatalf("invalid canonical control: %v\n%s", want.Diagnostics, want.Text)
			}
			if len(got.Diagnostics) != 0 || got.Text != want.Text {
				Gap(t, "FuzzFiberOperandTrivia", key, "%s; diagnostics %v\n%s\nwant:\n%s", fiberOperandTriviaQuote, got.Diagnostics, got.Text, want.Text)
			}
		}
		ExpectPending(t, "FuzzFiberOperandTrivia", key)
	})
}
