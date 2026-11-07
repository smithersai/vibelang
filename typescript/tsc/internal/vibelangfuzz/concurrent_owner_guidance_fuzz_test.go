package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const concurrentOwnerGuidanceQuote = "Whether an item gets its own fiber is \x60Effect.forEach\x60's choice."

func TestConcurrentOwnerGuidanceQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentOwnerGuidanceQuote)
	chapterSays(t, "002-running.md", "every limit at or below \x601\x60 runs the items in order on the enclosing fiber.")
}

func FuzzConcurrentOwnerGuidance(f *testing.F) {
	startShortBudget(f)
	limits := []string{"default", "one", "zero", "negative", "fraction", "nan", "unbounded"}
	jumps := []string{"break", "return", "outer-continue"}
	for _, limit := range limits {
		for _, jump := range jumps {
			f.Add(limit + ":" + jump)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		limit, jump, _ := strings.Cut(key, ":")
		if !slices.Contains(limits, limit) || !slices.Contains(jumps, jump) {
			t.Skip()
		}
		option := map[string]string{"default": "", "one": "(1)", "zero": "(0)", "negative": "(-2)", "fraction": "(1.5)", "nan": "(NaN)", "unbounded": "(\"unbounded\")"}[limit]
		source := "export effect function main(){for concurrent" + option + "(const item of [1,2]){void item;" + jump + "}}"
		want := 1903
		if jump == "return" {
			want = 1904
		}
		if jump == "outer-continue" {
			want = 1905
			source = "export effect function main(){outer:for(const outerItem of [1]){void outerItem;for concurrent" + option + "(const item of [1,2]){void item;continue outer}}}"
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r3Errors(r.Diagnostics)
		if len(errors) != 1 {
			Gap(t, "FuzzConcurrentOwnerGuidance", key, "exact jump diagnostic EK%d required, got %v", want, errors)
		}
		found := 0
		for _, d := range r.Diagnostics {
			if int(d.Code()) != want {
				continue
			}
			found++
			if strings.Contains(d.String(), "each item runs in its own fiber") {
				Gap(t, "FuzzConcurrentOwnerGuidance", key, "%s; sequential limits cannot promise child fibers: %s", concurrentOwnerGuidanceQuote, d.String())
			}
		}
		if found != 1 {
			Gap(t, "FuzzConcurrentOwnerGuidance", key, "the item boundary must report exactly one EK%d, got %d: %v", want, found, r.Diagnostics)
		}
		ExpectPending(t, "FuzzConcurrentOwnerGuidance", key)
	})
}
