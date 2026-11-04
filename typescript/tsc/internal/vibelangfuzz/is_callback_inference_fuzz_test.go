package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const isCallbackInferenceQuote = "`subject is P` evaluates the subject once and returns the pattern's Boolean result, using the same cache and finishing rules as `match`."

func requireIsCallbackInferenceQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("004-match.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), isCallbackInferenceQuote) {
		t.Fatalf("chapter 4 no longer says %q", isCallbackInferenceQuote)
	}
}
func TestIsCallbackInferenceQuoted(t *testing.T) { requireIsCallbackInferenceQuote(t) }

var isCallbackInferencePatterns = []struct{ key, subject, pattern string }{
	{"exit-failure", "try exit(Effect.fail(\"bad\"))", "Exit.Failure"},
	{"exit-success", "try exit(Effect.succeed(1))", "Exit.Success"},
	{"option-some", "try Effect.succeed(Option.some(1))", "Option.Some"},
	{"option-none", "try Effect.succeed(Option.none<number>())", "Option.None"},
	{"number", "try Effect.succeed(1)", "Number"},
	{"object", "try Effect.succeed({value: 1})", "{value: Number}"},
	{"array", "try Effect.succeed([1])", "[Number]"},
	{"nested", "try Effect.succeed({items: [1]})", "{items: [Number]}"},
}

// This is a static oracle, not a second runtime comparator: the chapter's
// Boolean predicate fits expect's unconstrained generic parameter in any
// enclosing Effect callback. It cannot require a recursive source contract.
func FuzzIsCallbackInference(f *testing.F) {
	startShortBudget(f)
	requireIsCallbackInferenceQuote(f)
	contexts := []string{"declaration", "callback", "nested-callback"}
	for _, p := range isCallbackInferencePatterns {
		for _, context := range contexts {
			f.Add([]byte(p.key + "/" + context))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		index, ctx := 0, 0
		if len(data) > 0 {
			index = int(data[0]) % len(isCallbackInferencePatterns)
		}
		if len(data) > 1 {
			ctx = int(data[1]) % len(contexts)
		}
		for i, p := range isCallbackInferencePatterns {
			for j, context := range contexts {
				if string(data) == p.key+"/"+context {
					index, ctx = i, j
				}
			}
		}
		p := isCallbackInferencePatterns[index]
		key := p.key + "/" + contexts[ctx]
		source := "declare function expect<T>(value: T): { toBe(expected: boolean): void }; declare function test<E,R>(fn: () => Effect.Effect<void,E,R>): void; "
		body := "expect(" + p.subject + " is " + p.pattern + ").toBe(true)"
		switch contexts[ctx] {
		case "declaration":
			source += "export effect function check() { " + body + " }"
		case "callback":
			source += "test(effect () => { " + body + " })"
		default:
			source += "test(effect () => { test(effect () => { " + body + " }) })"
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzIsCallbackInference", key, "Boolean pattern in generic callback: %s", d.String())
			}
		}
	})
}
