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
		v := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		label := []string{"item", "next", "loop"}[n%3]
		labels := []string{label + ":", label + ":alias:", "alias:" + label + ":"}[(n/3)%3]
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[(n/9)%4]
		source := fmt.Sprintf("export effect function main(){%s for concurrent%s(const x of [1]){%s};return 7}", labels, limit, strings.ReplaceAll(v.body, "LABEL", label))
		if v.key == "head-default" {
			source = fmt.Sprintf("export effect function main(){%s for concurrent%s(const {n=do {%s:{7};1}} of [{}]){};return 7}", labels, limit, label)
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
	})
}
