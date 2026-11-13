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
// Boolean predicate must retain exactly boolean in each enclosing Effect
// callback. A separate number assignment must fail with the native error.
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
		body := isCallbackBooleanWitness(p.subject + " is " + p.pattern)
		files := map[string]string{
			"main.vibe":    isCallbackContext(contexts[ctx], body),
			"control.vibe": isCallbackContext(contexts[ctx], "const invalid: number = ("+p.subject+" is "+p.pattern+");"),
		}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		controls := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.File() != nil && strings.HasSuffix(d.File().FileName().AsString(), "/control.vibe") && !IsEK(d) && d.Code() == 2322 {
				controls++
			} else {
				Gap(t, "FuzzIsCallbackInference", key, "Boolean pattern witness: %s", d.String())
			}
		}
		if controls != 1 {
			Gap(t, "FuzzIsCallbackInference", key, "non-Boolean annotation must report exactly one TS2322, got %d", controls)
		}
		ExpectPending(t, "FuzzIsCallbackInference", key)
		ExpectPending(t, "FuzzIsCallbackInference", specCorpusKey(t))
	})
}

// Check the inferred type too: an annotation alone would hide an any result.
// The conditional rejects any, unknown, literal booleans and non-Booleans.
func isCallbackBooleanWitness(expression string) string {
	return "const actual = (" + expression + "); const b: boolean = actual; const exact: 0 extends (1 & typeof actual) ? 0 : [typeof actual] extends [boolean] ? boolean extends typeof actual ? 1 : 0 : 0 = 1; void b; void exact; expect(" + expression + ").toBe(true);"
}

func isCallbackContext(context, body string) string {
	source := "export {}; declare function expect<T>(value: T): { toBe(expected: boolean): void }; declare function test<E,R>(fn: () => Effect.Effect<void,E,R>): void; "
	switch context {
	case "declaration":
		return source + "export effect function check() { " + body + " }"
	case "callback":
		return source + "test(effect () => { " + body + " })"
	default:
		return source + "test(effect () => { test(effect () => { " + body + " }) })"
	}
}
