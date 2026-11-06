package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

const concurrentFreshBindingQuote = "The head is a " + "\x60const\x60 or \x60let\x60 declaration, destructuring included:"

func TestConcurrentFreshBindingQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentFreshBindingQuote)
}

// VIP-19 retains native binding checks even when lowering creates an item
// callback. Compare each source head with the same head in a native for-of.
func FuzzConcurrentFreshBindings(f *testing.F) {
	startShortBudget(f)
	variants := []struct{ key, params, binding, items, body string }{
		{"empty-object", "", "{n=1}", "[{}]", "const value:number=n;void value"},
		{"renamed", "", "{n:value=1}", "[{}]", "const result:number=value;void result"},
		{"computed", "", "{[\"n\"]:n=1}", "[{}]", "const value:number=n;void value"},
		{"nested", "", "{inner:{n=1}}", "[{inner:{}}]", "const value:number=n;void value"},
		{"union", "", "{n=1}", "[{}, {n:2}]", "const value:number=n;void value"},
		{"array", "", "[n=1]", "[[]]", "const value:number=n;void value"},
		{"nested-array", "", "[{n=1}]", "[[{}]]", "const value:number=n;void value"},
		{"named-nested-array", "rows:{}[][]", "[{n=1}]", "rows", "void n"},
		{"rest", "", "{n=1,...rest}", "[{}]", "const value:number=n;void value;void rest"},
		{"named-object", "rows:{}[]", "{n=1}", "rows", "void n"},
		{"asserted-object", "", "{n=1}", "[{}] as {}[]", "void n"},
		{"required-property", "", "{n}", "[{}]", "void n"},
		{"wrong-default-type", "", "{n=1}", "[{}]", "const value:string=n;void value"},
		{"independent-body", "", "{n=1}", "[{}]", "void n;missing()"},
		{"rhs-capture", "probe:()=>unknown", "{n=1}", "(probe=()=>n.toFixed(),[{}])", "void n"},
	}
	keys := make([]string, len(variants))
	for i, row := range variants {
		keys[i] = row.key
		f.Add([]byte("key:" + row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentFreshBindingQuoted(t)
		row := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		kind := []string{"const", "let"}[n%2]
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[(n/2)%4]
		native := fmt.Sprintf("export function main(%s){for(%s %s of %s){%s};return 7}", row.params, kind, row.binding, row.items, row.body)
		source := fmt.Sprintf("export effect function main(%s){for concurrent%s(%s %s of %s){%s};return 7}", row.params, limit, kind, row.binding, row.items, row.body)
		reference, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": native}})
		if err != nil {
			t.Fatal(err)
		}
		defer reference.Remove()
		actual, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer actual.Remove()
		want, got := r3Errors(reference.Diagnostics), r3Errors(actual.Diagnostics)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzConcurrentFreshBindings", "binding:"+row.key, "chapter 2 says %q; native errors %v, concurrent errors %v\n%s\n%s", concurrentFreshBindingQuote, want, got, native, source)
		}
		ExpectPending(t, "FuzzConcurrentFreshBindings", "binding:"+row.key)
		ExpectPending(t, "FuzzConcurrentFreshBindings", specCorpusKey(t))
	})
}
