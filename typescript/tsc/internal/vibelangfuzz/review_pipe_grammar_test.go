package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

const reviewPipeTarget = "FuzzReviewPipeGrammar"
const reviewPipeChapterQuote = "The existing conditional, yield, assignment and arrow covering-production errors remain."
const reviewPipeSnapshotQuote = "it is **invalid** syntax to use **other** operators that have **similar precedence**\n(i.e., the arrow `=>`, the ternary conditional operator `?` `:`,\nthe assignment operators, and the `yield` operator)\nas a **pipe head or body**."

func TestReviewPipeGrammarQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), reviewPipeChapterQuote) {
		t.Fatalf("Chapter 2 no longer says %q", reviewPipeChapterQuote)
	}
	text, err := os.ReadFile(SpecPath("../vips/tc39-pipeline-operator/explainer.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), reviewPipeSnapshotQuote) {
		t.Fatalf("pinned pipe snapshot no longer says %q", reviewPipeSnapshotQuote)
	}
}

// ASTRA-2 and OPUS-2: the conditional cannot take an unparenthesized pipe
// as its test. The two explicit repairs and ordinary branch pipes are valid.
// This checks syntax admission, not the runtime value of either grouping.
func FuzzReviewPipeGrammar(f *testing.F) {
	startShortBudget(f)
	forms := []string{"identity", "arithmetic", "body-grouping"}
	for _, form := range forms {
		f.Add(form, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form string, value uint8) {
		TestReviewPipeGrammarQuoted(t)
		if !slices.Contains(forms, form) {
			if form == "" {
				return
			}
			form = forms[int(form[0])%len(forms)]
		}
		n := int(value%8) + 1
		body := "%"
		if form == "arithmetic" {
			body = fmt.Sprintf("%% + %d", n)
		}
		if form == "body-grouping" {
			body = "(% + 1)"
		}
		head := "input |> " + body
		controls := []string{
			"(" + head + ") ? 11 : 22",
			"input |> (% ? 11 : 22)",
			"input ? (11 |> % + 1) : 22",
			"input ? 11 : (22 |> % + 1)",
		}
		check := func(expression string, invalid bool) {
			t.Helper()
			source := "export function probe(input: number): number { return " + expression + " }\n"
			var result *Result
			var err error
			within(t, "compile pipe grammar", func() { result, err = w.Compile(t.Context(), Single(source)) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if result.Program == nil {
				t.Fatal("pipe grammar has no program")
			}
			key := "reject:" + form
			if invalid && !HasError(result.Diagnostics) {
				Gap(t, reviewPipeTarget, key, "ASTRA-2/OPUS-2: Chapter 2 %q and pinned pipe covering rules require rejecting the unparenthesized conditional test; accepted %s", reviewPipeChapterQuote, source)
			} else if !invalid && HasError(result.Diagnostics) {
				Gap(t, reviewPipeTarget, "control:"+form, "explicit pipe repair must compile, got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			if invalid {
				ExpectPending(t, reviewPipeTarget, key)
			}
		}
		for _, control := range controls {
			check(control, false)
		}
		check(head+" ? 11 : 22", true)
		ExpectPending(t, reviewPipeTarget, specCorpusKey(t))
	})
}
