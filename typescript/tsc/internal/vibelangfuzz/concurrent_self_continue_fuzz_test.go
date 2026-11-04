package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

const concurrentSelfContinueQuote = "`continue`, and a labeled `continue` naming the `for concurrent` itself, end that one item: each is `return` from the item\u0027s generator, as the example shows."

func TestConcurrentSelfContinueQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentSelfContinueQuote)
}

// Static admission complements the existing vip19.self-continue runtime
// differential. Mutations change labels, native nesting and concurrency.
func FuzzConcurrentSelfContinue(f *testing.F) {
	startShortBudget(f)
	variants := []struct{ key, body, want string }{
		{"direct", "continue own", ""},
		{"conditional", "if(x===1)continue own", ""},
		{"switch", "switch(x){case 1:continue own;default:break}", ""},
		{"for", "for(let i=0;i<2;i++)continue own", ""},
		{"for-of", "for(const y of [1,2])continue own", ""},
		{"for-in", "for(const y in {a:1})continue own", ""},
		{"while", "while(x===1)continue own", ""},
		{"do-while", "do continue own;while(x===1)", ""},
		{"local", "inner:for(const y of [1]){continue inner};continue own", ""},
		{"mask", "uninterruptible {continue own}", ""},
		{"nested-item", "for concurrent(const y of [1]){continue own}", "EK1905"},
		{"native-function", "function f(){continue own}", "TS1107"},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte("key:" + v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentSelfContinueQuoted(t)
		v := variants[r3Pick(data, keys)]
		labels := []string{"own:", "own:alias:", "alias:own:"}
		limits := []string{"", "(1)", "(2)", "(\"unbounded\")"}
		mutation := 0
		if len(data) > 0 {
			mutation = int(data[len(data)-1])
		}
		source := fmt.Sprintf("export effect function main(){%s for concurrent%s (const x of [1,2]){%s};return 7}", labels[mutation%len(labels)], limits[mutation%len(limits)], v.body)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if errs := r3Errors(r.Diagnostics); (v.want == "" && len(errs) != 0) || (v.want != "" && !slices.Contains(errs, v.want)) {
			Gap(t, "FuzzConcurrentSelfContinue", "admission:"+v.key, "chapter 2 says %q; expected error %q; diagnostics %v", concurrentSelfContinueQuote, v.want, errs)
		}
	})
}
