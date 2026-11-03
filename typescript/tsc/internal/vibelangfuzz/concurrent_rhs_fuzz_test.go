package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentRHSQuote = "In both `for concurrent` and `for try`, head bindings are uninitialized in a separate lexical environment while evaluating the right-hand operand"
const concurrentRHSTarget = "FuzzConcurrentRHSBindings"
const concurrentJumpQuote = "A `for concurrent` head's binding initialization or body can't produce a `break` it doesn't consume, a `return` or a `continue` naming an enclosing statement"

func TestConcurrentRHSBindingsQuoted(t *testing.T) { concurrentRHSChapter(t) }

func concurrentRHSChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), concurrentRHSQuote) {
		t.Fatalf("chapter 2 no longer says %q", concurrentRHSQuote)
	}
	if !strings.Contains(string(text), concurrentJumpQuote) {
		t.Fatalf("chapter 2 no longer says %q", concurrentJumpQuote)
	}
}

// VIP-19's RHS closures can name the head, with the item's inferred type
// and the written const/let kind. Runtime identity is compared by the existing
// vip19.rhs-tdz construct; these shapes check its binding neighbourhood.
func FuzzConcurrentRHSBindings(f *testing.F) {
	startShortBudget(f)
	concurrentRHSChapter(f)
	sites := []struct {
		key, head, items, capture string
		code                      int32
	}{
		{"const", "const value", "[1]", "value.toFixed()", 0},
		{"let", "let value", "[1]", "value.toFixed()", 0},
		{"object", "const { value }", "[{ value: 1 }]", "value.toFixed()", 0},
		{"renamed", "let { n: value }", "[{ n: 1 }]", "value.toFixed()", 0},
		{"nested", "const { n: { value } }", "[{ n: { value: 1 } }]", "value.toFixed()", 0},
		{"array", "let [value]", "[[1]]", "value.toFixed()", 0},
		{"rest", "const [value, ...tail]", "[[1, 2]]", "value.toFixed() + tail.length", 0},
		{"object-rest", "const { n, ...value }", "[{ n: 1, text: 'ok' }]", "value.text.toUpperCase()", 0},
		{"default", "const { value = 1 }", "[{}] as Array<{ value?: number }>", "value.toFixed()", 0},
		{"empty", "let value", "[] as number[]", "value.toFixed()", 0},
		{"const-write", "const value", "[1]", "(value = 2)", 2588},
		{"let-write", "let value", "[1]", "(value = 2)", 0},
		{"wrong-member", "const value", "[1]", "value.missing", 2339},
		{"vibex", "const value", "[1]", "value.toFixed()", 0},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		site := sites[concurrentHeadChoice(keys, data)]
		// An outer string must never supply the RHS head's number/object type.
		source := "export effect function scenario() { const value = 'outer'; let read: () => unknown = () => 0; for concurrent(1) (" + site.head + " of (read = (): unknown => " + site.capture + ", " + site.items + ")) { } return read }"
		project := Single(source)
		if site.key == "vibex" {
			project = Project{Files: map[string]string{"main.vibex": source}, Config: strings.Replace(DefaultConfig, `"target":`, `"jsx": "react", "target":`, 1)}
		}
		r, err := w.Compile(context.Background(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := "rule:" + site.key
		errors := int32(0)
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors++
			}
		}
		if site.code == 0 && HasError(r.Diagnostics) || site.code != 0 && (countCode(r.Diagnostics, site.code) != 1 || errors != 1) {
			Gap(t, concurrentRHSTarget, key, "%s; want diagnostic %d, got %v\n%s", concurrentRHSQuote, site.code, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, concurrentRHSTarget, key)
		ExpectPending(t, concurrentRHSTarget, specCorpusKey(t))
	})
}

// Static jump ownership must survive both the limit and head wrappers.
func FuzzConcurrentHeadContinues(f *testing.F) {
	startShortBudget(f)
	concurrentRHSChapter(f)
	shapes := []struct {
		key, outer, inner, body string
		code                    int32
	}{
		{"unbounded-outward", "", "", "continue outer", 1905},
		{"bounded-outward", "(1)", "(1)", "continue outer", 1905},
		{"bounded-outer", "(1)", "", "continue outer", 1905},
		{"bounded-inner", "", "(1)", "continue outer", 1905},
		{"native-loop-outward", "(1)", "(1)", "for (const y of [1]) { continue outer }", 1905},
		{"local-continue", "(1)", "(1)", "continue", 0},
		{"self-label", "(1)", "(1)", "continue inner", 0},
		{"native-local", "(1)", "(1)", "local: for (const y of [1]) { continue local }", 0},
		{"do-value", "(1)", "(1)", "const value = do { 1 }; void value", 0},
		{"do-array", "(1)", "(1)", "const value = do { [1] }; void value", 0},
	}
	keys := make([]string, len(shapes))
	for i, shape := range shapes {
		keys[i] = shape.key
		f.Add([]byte(shape.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		shape := shapes[concurrentHeadChoice(keys, data)]
		source := "export effect function f() { outer: for concurrent" + shape.outer + " (const n of [1]) { inner: for concurrent" + shape.inner + " (const x of [1]) { " + shape.body + " } } }"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := 0
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors++
			}
		}
		key := "rule:" + shape.key
		if shape.code == 0 && errors != 0 || shape.code != 0 && (errors != 1 || countCode(r.Diagnostics, shape.code) != 1) {
			Gap(t, "FuzzConcurrentHeadContinues", key, "%s; want diagnostic %d, got %v\n%s", concurrentJumpQuote, shape.code, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzConcurrentHeadContinues", key)
		ExpectPending(t, "FuzzConcurrentHeadContinues", specCorpusKey(t))
	})
}
