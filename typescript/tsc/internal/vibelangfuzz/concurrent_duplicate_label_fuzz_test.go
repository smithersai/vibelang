package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const concurrentDuplicateLabelQuote = "Its names and jumps mean what they mean in the source, as ECMAScript defines them:"

func TestConcurrentDuplicateLabelQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentDuplicateLabelQuote)
}

// Source labels remain active through an item callback. Written callables
// introduce their own scope; sibling statements may reuse a label.
func FuzzConcurrentDuplicateLabel(f *testing.F) {
	startShortBudget(f)
	variants := []struct {
		key, body string
		duplicate bool
	}{
		{"head-default", "", true},
		{"head-default-control", "", false},
		{"head-default-contextual", "", false},
		{"native-loop", "LABEL:for(const y of [1]){continue LABEL}", true},
		{"block", "LABEL:{7}", true},
		{"nested-item", "for concurrent(const y of [1]){LABEL:{7}}", true},
		{"do", "const v=do {LABEL:{7};7};void v", true},
		{"mask", "uninterruptible{LABEL:{7}}", true},
		{"function", "function f(){LABEL:for(const y of [1]){continue LABEL}}", false},
		{"arrow", "const f=()=>{LABEL:for(const y of [1]){continue LABEL}}", false},
		{"method", "const o={f(){LABEL:for(const y of [1]){continue LABEL}}}", false},
		{"effect-function", "effect function f(){LABEL:for(const y of [1]){continue LABEL}}", false},
		{"sibling-labels", "local:{7};local:{8}", false},
		{"different-label", "local:for(const y of [1]){continue local}", false},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte("key:" + v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentDuplicateLabelQuoted(t)
		TestConcurrentHeadDefaultQuoted(t)
		v := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		label := []string{"item", "next", "loop"}[n%3]
		labels := []string{label + ":", label + ":alias:", "alias:" + label + ":"}[(n/3)%3]
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[(n/9)%4]
		source := fmt.Sprintf("export effect function main(){%s for concurrent%s(const x of [1]){%s};return 7}", labels, limit, strings.ReplaceAll(v.body, "LABEL", label))
		if v.key == "head-default-control" {
			source = concurrentHeadDefaultSource(labels, limit, "1")
		}
		if v.key == "head-default-contextual" {
			source = fmt.Sprintf("export effect function main(){%s for concurrent%s(const {n=1} of [{}]){};return 7}", labels, limit)
		}
		if v.key == "head-default" {
			source = concurrentHeadDefaultSource(labels, limit, fmt.Sprintf("do {%s:{7};1}", label))
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := r3Errors(r.Diagnostics)
		var want []string
		if v.duplicate {
			want = []string{"TS1114"}
		}
		if !slices.Equal(got, want) {
			Gap(t, "FuzzConcurrentDuplicateLabel", "scope:"+v.key, "chapter 2 says %q; expected %v, got %v\n%s", concurrentDuplicateLabelQuote, want, got, source)
		}
		ExpectPending(t, "FuzzConcurrentDuplicateLabel", "scope:"+v.key)
		ExpectPending(t, "FuzzConcurrentDuplicateLabel", specCorpusKey(t))
	})
}

// concurrentHeadDefaultSource also builds a binding-only control by replacing
// the do initializer with an ordinary expression.
func concurrentHeadDefaultSource(labels, limit, initializer string) string {
	return fmt.Sprintf("export effect function main(rows:ReadonlyArray<{n?:number}>){%s for concurrent%s(const {n=%s} of rows){};return 7}", labels, limit, initializer)
}

func TestConcurrentHeadDefaultTyping(t *testing.T) {
	TestConcurrentDuplicateLabelQuoted(t)
	TestConcurrentHeadDefaultQuoted(t)
	w := NewWorkspace(t)
	for _, labels := range []string{"item:", "item:alias:", "alias:item:"} {
		for _, limit := range []string{"", "(1)", "(2)", "(\"unbounded\")"} {
			source := concurrentHeadDefaultSource(labels, limit, "1")
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			got := r3Errors(r.Diagnostics)
			r.Remove()
			if len(got) != 0 {
				t.Errorf("valid head control: want no errors got %v\n%s", got, source)
			}
		}
		source := concurrentHeadDefaultSource(labels, "", "1")
		source = strings.ReplaceAll(source, "effect function", "function")
		source = strings.ReplaceAll(source, "for concurrent", "for")
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		if len(got) != 0 {
			t.Errorf("native head control: want no errors got %v\n%s", got, source)
		}
	}
}

func TestConcurrentHeadDefaultQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "The head is a \x60const\x60 or \x60let\x60 declaration, destructuring included:")
}
