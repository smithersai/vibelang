package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectWrittenContainerQuote = "A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`, an alias included, as TS1064 requires `Promise<T>` for `async` (`any`, `unknown` and `never` are errors)"

var effectWrittenAnnotations = []struct{ key, text string }{
	{"any", "any"}, {"unknown", "unknown"}, {"alias-any", "AnyAlias"}, {"alias-unknown", "UnknownAlias"},
	{"parenthesized", "(unknown)"}, {"union-any", "number | any"}, {"union-unknown", "number | unknown"},
	{"intersection-any", "unknown & any"}, {"conditional", "true extends true ? unknown : number"}, {"never", "never"}, {"commented-unknown", "/*contract*/ unknown"}, {"literal-url", "unknown | \"https://example.test\""},
}

func TestEffectWrittenContainerQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectWrittenContainerQuote) {
		t.Fatal("VIP-1 written-container quote changed")
	}
}

// A stable annotation key and a callable mutation exercise the rule and
// its positive controls independently of the compiler's current behavior.
func FuzzEffectWrittenContainer(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectWrittenContainerQuote) {
		f.Fatal("stale VIP-1 written-container quote")
	}
	code := chapterCode(f, chapter, effectWrittenContainerQuote)
	w := NewWorkspace(f)
	for _, a := range effectWrittenAnnotations {
		for form := range uint8(5) {
			f.Add([]byte(a.key), form)
		}
	}
	f.Fuzz(func(t *testing.T, data []byte, form uint8) {
		a := effectWrittenAnnotations[0]
		found := false
		for _, candidate := range effectWrittenAnnotations {
			if string(data) == candidate.key {
				a, found = candidate, true
				break
			}
		}
		if !found && len(data) > 0 {
			a = effectWrittenAnnotations[int(data[0])%len(effectWrittenAnnotations)]
		}
		forms := []string{
			"export effect function f(): %s { return 1 }",
			"export const f = effect function(): %s { return 1 }",
			"export const f = effect (): %s => 1",
			"export const o = { effect f(): %s { return 1 } }",
			"export class C { effect f(): %s { return 1 } }",
		}
		prefix := "import { Effect } from \"effect\"; type AnyAlias = any; type UnknownAlias = unknown;\n"
		compile := func(annotation string) *Result {
			r, err := w.Compile(context.Background(), Single(prefix+fmt.Sprintf(forms[int(form)%len(forms)], annotation)))
			if err != nil {
				t.Fatal(err)
			}
			return r
		}
		// Real containers with any/unknown success types must remain valid.
		control := compile([]string{"number!!", "any!!", "unknown!!"}[int(form)%3])
		defer control.Remove()
		if HasError(control.Diagnostics) {
			t.Fatalf("valid Effect container rejected: %v", Keys(control.Dir, control.Diagnostics))
		}
		r := compile(a.text)
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == code && d.Category() == diagnostics.CategoryError {
				count++
			}
		}
		key := fmt.Sprintf("annotation:%s/form:%d", a.key, form%5)
		if count != 1 {
			Gap(t, "FuzzEffectWrittenContainer", key, "%s; want exactly one EK%04d, got %d: %v", effectWrittenContainerQuote, code, count, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, "FuzzEffectWrittenContainer", key)
	})
}
