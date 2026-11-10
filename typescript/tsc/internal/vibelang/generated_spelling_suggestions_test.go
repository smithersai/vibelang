package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGeneratedSpellingSuggestions(t *testing.T) {
	for _, row := range []struct{ key, before, head, body, needle string }{
		{"unknown", "", "x", "void $concurrentIte", "$concurrentIte"},
		{"exact-source-name", "", "x", "void $concurrentItem", "$concurrentItem"},
		{"type-query", "", "x", "type T=typeof $concurrentIte;void 0", "$concurrentIte"},
		{"outer-source-candidate", "const $concurrentItems=1;", "x", "void $concurrentIte", "$concurrentIte"},
		{"source-temporary-name", "const $concurrentItem=1;", "x", "void $concurrentIte", "$concurrentIte"},
		{"head-source-name", "", "$concurrentItem", "void $concurrentIte", "$concurrentIte"},
		{"ordinary-suggestion", "const item=1;", "x", "void itme", "itme"},
		{"case-only", "", "item", "void Item", "Item"},
	} {
		for _, limit := range []string{"", "(1)", "(2)"} {
			t.Run(row.key+"/"+limit, func(t *testing.T) {
				errors := func(loop string) []string {
					source := "export effect function f(xs:number[]){" + row.before + loop + "(const " + row.head + " of xs){" + row.body + "}}"
					p, f, _, _ := editorProgram(t, source)
					at := strings.LastIndex(source, row.needle)
					var got []string
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Category() == diagnostics.CategoryError {
							got = append(got, fmt.Sprintf("%s%d@%d+%d:%s", d.Source(), d.Code(), d.Pos()-at, d.Len(), d.String()))
						}
					}
					slices.Sort(got)
					return got
				}
				want := errors("for")
				got := errors("for concurrent" + limit)
				if len(want) != 1 {
					t.Fatalf("native control: %v", want)
				}
				if !slices.Equal(got, want) {
					t.Fatalf("native %v\nconcurrent %v", want, got)
				}
			})
		}
	}
}
