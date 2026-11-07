package vibelang

import (
	"strings"
	"testing"
)

// EK4823, EK4824 and EK4825 are off until a project turns them on (D241).
// A project that turns one on, at any severity, makes its reports part of the
// repository's own lint, so ordinary --fix applies that rule's repair; a
// project that leaves it off keeps the text --fix found. alchemy's converted
// modules otherwise kept effect arrows whose block only returns, and its lint
// rejected them.
func TestFixAppliesStyleRepairsOnlyForEnabledRules(t *testing.T) {
	const source = "export const make = effect (value: number) => { return { value }; }\n" +
		"export const plain = (n: number) => { return n + 1; }\n" +
		"export const empty = Effect.succeed(1).pipe()\n" +
		"export const bare = pipe(Effect.succeed(1))\n" +
		"export const chain = pipe(pipe(Effect.succeed(1), Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))\n"
	arrows := []string{
		"export const make = effect (value: number) => ({ value })\n",
		"export const plain = (n: number) => n + 1\n",
	}
	pipes := []string{
		"export const empty = Effect.succeed(1)\n",
		"export const bare = Effect.succeed(1)\n",
	}
	const chain = "export const chain = pipe(Effect.succeed(1), Effect.map((n: number) => n + 1), Effect.map((n: number) => n * 2))\n"
	keepArrows := []string{"{ return { value }; }", "{ return n + 1; }"}
	keepPipes := []string{".pipe()\n", "pipe(Effect.succeed(1))\n"}
	const keepChain = "pipe(pipe("
	all := func(lists ...[]string) []string {
		var out []string
		for _, list := range lists {
			out = append(out, list...)
		}
		return out
	}
	config := func(extra string) string {
		return `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,` +
			`"plugins":[{"name":"@effect/language-service"}]}` + extra + `,"files":["main.vibe"]}`
	}
	for _, test := range []struct {
		name, config, source string
		want, keep           []string
	}{
		{name: "no plugin", config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`,
			source: source, keep: all(keepArrows, keepPipes, []string{keepChain})},
		{name: "plugin with the rules at their default, off", config: config(""),
			source: source, keep: all(keepArrows, keepPipes, []string{keepChain})},
		{name: "all three on through their lint codes", config: config(`,"vibe":{"severities":{"EK38123":"error","EK38126":"error","EK38127":"error"}}`),
			source: source, want: all(arrows, pipes, []string{chain})},
		{name: "a warning is on", config: config(`,"vibe":{"severities":{"EK38123":"warning","EK38126":"warning","EK38127":"warning"}}`),
			source: source, want: all(arrows, pipes, []string{chain})},
		{name: "a suggestion is on", config: config(`,"vibe":{"severities":{"EK38123":"suggestion"}}`),
			source: source, want: arrows, keep: all(keepPipes, []string{keepChain})},
		{name: "only the pipe rules on", config: config(`,"vibe":{"severities":{"EK38126":"error","EK38127":"error"}}`),
			source: source, want: all(pipes, []string{chain}), keep: keepArrows},
		{name: "a rule turned off stays off", config: config(`,"vibe":{"severities":{"EK38123":"off","EK38126":"error","EK38127":"off"}}`),
			source: source, want: pipes, keep: all(keepArrows, []string{keepChain})},
		{name: "a file comment turns on the port code", config: config(""),
			source: "// @vibelang-diagnostics EK4823:error\n" + source, want: arrows, keep: all(keepPipes, []string{keepChain})},
		{name: "a comment between pipe arguments keeps its pipe", config: config(`,"vibe":{"severities":{"EK38126":"error","EK38127":"error"}}`),
			source: "export const e = Effect.succeed(1).pipe(/* why */)\n" +
				"export const f = pipe(pipe(Effect.succeed(1), /* first */ Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))\n" +
				"export const g = pipe(pipe(Effect.succeed(1), Effect.map((n: number) => /* kept */ n + 1)), Effect.map((n: number) => n * 2))\n",
			want: []string{"export const g = pipe(Effect.succeed(1), Effect.map((n: number) => /* kept */ n + 1), Effect.map((n: number) => n * 2))\n"},
			keep: []string{".pipe(/* why */)\n", "pipe(pipe(Effect.succeed(1), /* first */ Effect.map("}},
		{name: "a returned comma expression keeps its parentheses", config: config(`,"vibe":{"severities":{"EK38123":"error"}}`),
			source: "export const pairs = [1, 2].map((n) => { return n, 3 })\n",
			want: []string{"export const pairs = [1, 2].map((n) => (n, 3))\n"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": test.source, "tsconfig.json": test.config})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := fixedText(result, "main.vibe")
			if fixed == "" {
				fixed = test.source
			}
			for _, want := range test.want {
				if !strings.Contains(fixed, want) {
					t.Errorf("--fix did not write %q:\n%s\nrefused: %+v", want, fixed, result.Refused)
				}
			}
			for _, keep := range test.keep {
				if !strings.Contains(fixed, keep) {
					t.Errorf("--fix rewrote %q, a rule the project leaves off:\n%s", keep, fixed)
				}
			}
		})
	}
}
