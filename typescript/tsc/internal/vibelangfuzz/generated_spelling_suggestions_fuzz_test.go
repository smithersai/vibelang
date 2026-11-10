package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const generatedSpellingTarget = "FuzzGeneratedSpellingSuggestions"

func TestGeneratedSpellingSuggestionsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript")
}

// Native loops expose only source bindings. Generated callback parameters
// cannot change a missing-name diagnostic or displace a real source hint.
func FuzzGeneratedSpellingSuggestions(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, before, head, body, needle string }{
		{"unknown", "", "x", "void $concurrentIte", "$concurrentIte"},
		{"exact", "", "x", "void $concurrentItem", "$concurrentItem"},
		{"query", "", "x", "type T=typeof $concurrentIte;void 0", "$concurrentIte"},
		{"source-candidate", "const $concurrentItems=1;", "x", "void $concurrentIte", "$concurrentIte"},
		{"source-temporary-name", "const $concurrentItem=1;", "x", "void $concurrentIte", "$concurrentIte"},
		{"head-source-name", "", "$concurrentItem", "void $concurrentIte", "$concurrentIte"},
		{"ordinary", "const item=1;", "x", "void itme", "itme"},
		{"case-only", "", "item", "void Item", "Item"},
	}
	keys := make([]string, len(rows))
	for i, row := range rows {
		keys[i] = row.key
		f.Add([]byte(row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestGeneratedSpellingSuggestionsQuoted(t)
		selected, tail := keyedChoice(keys, data)
		row := rows[selected]
		bits := byte(0)
		if len(tail) > 0 {
			bits = tail[0]
		}
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[int(bits)%4]
		kind := []string{"const ", "let "}[int(bits/4)%2]
		frame := []string{"export effect function f(xs:number[]){%s}", "export class C{effect f(xs:number[]){%s}}"}[int(bits/8)%2]
		errors := func(loop string) ([]string, string) {
			source := fmt.Sprintf(frame, row.before+loop+"("+kind+row.head+" of xs){"+row.body+"}")
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			at := strings.LastIndex(source, row.needle)
			var got []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, fmt.Sprintf("%s%d@%d+%d:%s", d.Source(), d.Code(), d.Pos()-at, d.Len(), d.String()))
				}
			}
			slices.Sort(got)
			return got, source
		}
		want, _ := errors("for")
		got, source := errors("for concurrent" + limit)
		key := "hint:" + row.key
		if !slices.Equal(got, want) {
			Gap(t, generatedSpellingTarget, key, "source-only native suggestions %v, concurrent %v\n%s", want, got, source)
		}
		ExpectPending(t, generatedSpellingTarget, key)
		ExpectPending(t, generatedSpellingTarget, specCorpusKey(t))
	})
}
