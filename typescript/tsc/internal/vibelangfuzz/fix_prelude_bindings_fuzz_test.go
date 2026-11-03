package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// The Smithers apps/mvp migration removed adjacent HttpClientRequest and
// type HttpClientResponse bindings with overlapping edits, losing the brace.
// Generate their orders, layouts and removal sets, then use the shared fix
// oracle: no added errors, preserved declarations and a stable fixed point.
// The explicit alias keeps an import while the other bindings can disappear.
const preludeBindingParseQuote = "Quick fixes and codemods use the formatter to preserve the parse under Appendix A."

func TestFixPreludeBindingsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), preludeBindingParseQuote) {
		t.Fatal("Chapter 7 changed its codemod parse-preservation rule")
	}
}

func FuzzFixPreludeBindings(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("007-tooling.md"), preludeBindingParseQuote) {
		f.Fatal("codemod parse quote changed")
	}
	bindings := []string{"HttpClient as Http", "HttpClientRequest", "type HttpClientResponse"}
	uses := "export type Kept = Http.HttpClient\nconst get = (url: string) => HttpClientRequest.get(url)\nconst status = (r: HttpClientResponse.HttpClientResponse) => r.status\n"
	var orders [][]int
	var permute func([]int)
	permute = func(prefix []int) {
		if len(prefix) == len(bindings) {
			orders = append(orders, prefix)
			return
		}
		for i := range bindings {
			if !slices.Contains(prefix, i) {
				permute(append(slices.Clone(prefix), i))
			}
		}
	}
	permute(nil)
	for i, order := range orders {
		if testing.Short() && i >= 3 {
			break
		}
		var names []string
		for _, index := range order {
			names = append(names, bindings[index])
		}
		separator := ", "
		trailing := ""
		if i%2 != 0 {
			separator, trailing = ",\n  ", ","
		}
		source := fmt.Sprintf("import { %s%s } from \"effect/http\"\n%s", strings.Join(names, separator), trailing, uses)
		f.Add(Archive(map[string]string{"main.vibe": source}))
	}
	fuzzFixProjects(f, "FuzzFixPreludeBindings")
}
