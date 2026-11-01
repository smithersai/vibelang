package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const concurrentHeadTarget = "FuzzConcurrentHeadBindings"
const concurrentHeadQuote = "A `try` in a destructuring default in effect code runs in the enclosing effect function"

func TestConcurrentHeadBindingsQuoted(t *testing.T) {
	concurrentHeadChapter(t)
}

// A for concurrent head pattern binds inside the item: a do with a try in a
// default or a computed key runs there and gives its value, so the binding
// has the value's type and the program compiles without a type error.
func FuzzConcurrentHeadBindings(f *testing.F) {
	startShortBudget(f)
	concurrentHeadChapter(f)
	sites := []struct{ key, head, items, use string }{
		{"identifier", "const x", "[1]", "x + 0"},
		{"object-default", "const { n = 2 }", "[{}] as Array<{ n?: number }>", "n + 0"},
		{"object-default-do", "const { n = do { 2 } }", "[{}] as Array<{ n?: number }>", "n + 0"},
		{"object-default-do-try", "const { n = do { 2 + try poll } }", "[{}] as Array<{ n?: number }>", "n + 0"},
		{"computed-key-do", "const { [do { \"k\" }]: m }", "[{ k: 4 }] as Array<Record<string, number>>", "m + 0"},
		{"computed-key-do-try", "const { [do { try poll; \"k\" }]: m }", "[{ k: 4 }] as Array<Record<string, number>>", "m + 0"},
		{"array-default-do-try", "const [a = do { try poll; 5 }]", "[[]] as Array<Array<number>>", "a + 0"},
		{"nested-default-do-try", "const { nested: { v = do { (try poll) + 5 } } }", "[{ nested: {} }] as Array<{ nested: { v?: number } }>", "v + 0"},
		{"let-default-do-try", "let { n = do { try poll } }", "[{}] as Array<{ n?: number }>", "n += 1"},
		{"const-assign", "const { n = 1 }", "[{}] as Array<{ n?: number }>", "n = 2"},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := concurrentHeadChoice(keys, data)
		site := sites[choice]
		source := "import { Effect } from \"effect\";\ndeclare const poll: Effect.Effect<number>;\nexport effect function f() { for concurrent (" + site.head + " of " + site.items + ") { " + site.use + " } }"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := "rule:" + site.key
		if site.key == "const-assign" {
			// A const head binding stays a constant inside the item (TS2588).
			if n := countCode(r.Diagnostics, 2588); n != 1 {
				Gap(t, concurrentHeadTarget, key, "a const head binding is a constant: expected TS2588\n%s\n%v", source, Keys(r.Dir, r.Diagnostics))
			}
		} else if HasError(r.Diagnostics) {
			Gap(t, concurrentHeadTarget, key, "%s; the head binding must have the value's type\n%s\n%v", concurrentHeadQuote, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, concurrentHeadTarget, key)
		ExpectPending(t, concurrentHeadTarget, specCorpusKey(t))
	})
}

func concurrentHeadChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), concurrentHeadQuote) {
		t.Fatalf("chapter 2 no longer says %q", concurrentHeadQuote)
	}
}

// concurrentHeadChoice picks the site named by data, or by its first byte.
func concurrentHeadChoice(keys []string, data []byte) int {
	for i, key := range keys {
		if string(data) == key || strings.HasPrefix(string(data), key+":") {
			return i
		}
	}
	if len(data) > 0 {
		return int(data[0]) % len(keys)
	}
	return 0
}

func countCode(diagnostics []*ast.Diagnostic, code int32) int {
	n := 0
	for _, d := range diagnostics {
		if d.Code() == code {
			n++
		}
	}
	return n
}
