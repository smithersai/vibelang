package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const producerScopeTarget = "FuzzProducerScopeInference"
const producerScopeQuote = "then expose `Exclude<RBody, Scope.Scope>` on the `Stream`"

func producerScopeVIP(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips/0021-producers.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), producerScopeQuote) {
		t.Fatalf("VIP-21 no longer says %q", producerScopeQuote)
	}
}
func TestProducerScopeInferenceQuoted(t *testing.T) { producerScopeVIP(t) }

// A producer's inferred Stream requirements are its body's without Scope
// (VIP-21, amended 2026-10-30; decided detail 225): the producer's declared
// type must equal Stream<number, never, R> for the body's other services R,
// which the program checks by assigning both ways.
func FuzzProducerScopeInference(f *testing.F) {
	startShortBudget(f)
	producerScopeVIP(f)
	sites := []struct{ key, body, want string }{
		{"plain", "yield 7", "never"},
		{"scoped-fork", "const child = try Effect.forkScoped(poll); yield 7", "never"},
		{"scoped-twice", "try Effect.forkScoped(poll); try Effect.forkScoped(poll); yield 7", "never"},
		{"one-service", "const a = try needsA; yield a", "A"},
		{"scoped-one-service", "const a = try needsA; try Effect.forkScoped(poll); yield a", "A"},
		{"scoped-two-services", "try Effect.forkScoped(poll); const a = try needsA; const b = try needsB; yield a + b", "A | B"},
		{"scope-valued-data", "const s: Scope.Scope | null = null; yield s === null ? 7 : 8", "never"},
		{"scope-in-ordinary-effect", "", "control"},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		site := sites[choice]
		prelude := "import { Effect, Scope, Stream } from \"effect\";\ndeclare const poll: Effect.Effect<number>;\nexport interface A { readonly a: number }\nexport interface B { readonly b: number }\ndeclare const needsA: Effect.Effect<number, never, A>;\ndeclare const needsB: Effect.Effect<number, never, B>;\n"
		var source string
		if site.want == "control" {
			// An ordinary effect function keeps Scope: the subtraction is the producer's alone.
			source = prelude + "export effect function f() { const child = try Effect.forkScoped(poll); return 7 }\nconst same: Effect.Effect<number, never, Scope.Scope> = f()\nconst back: ReturnType<typeof f> = null as unknown as Effect.Effect<number, never, Scope.Scope>\nexport {}"
		} else {
			source = prelude + "export effect function* p() { " + site.body + " }\nconst same: Stream.Stream<number, never, " + site.want + "> = p()\nconst back: ReturnType<typeof p> = null as unknown as Stream.Stream<number, never, " + site.want + ">\nexport {}"
		}
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := "rule:" + site.key
		if HasError(r.Diagnostics) {
			Gap(t, producerScopeTarget, key, "%s; the producer's Stream must be exactly Stream<number, never, %s>\n%s\n%v", producerScopeQuote, site.want, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, producerScopeTarget, key)
		ExpectPending(t, producerScopeTarget, specCorpusKey(t))
	})
}
