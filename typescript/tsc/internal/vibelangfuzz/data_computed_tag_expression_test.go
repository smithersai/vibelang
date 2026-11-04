package vibelangfuzz

import (
	"fmt"
	"testing"
)

func TestDataComputedTagInvalidExpressions(t *testing.T) {
	w := NewWorkspace(t)
	for _, tc := range []struct{ name, source string }{
		{"computed-tag-invalid-parenthesized", `const key="_tag";export data D { A { readonly [(key)]:string } }`},
		{"computed-tag-invalid-element", `const names={tag:"_tag"} as const;export data D { A { readonly [names["tag"]]:string } }`},
		{"computed-tag-invalid-call", `function key():"_tag"{return "_tag"}export data D { A { readonly [key()]:string } }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": tc.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []int32
			for _, d := range r.Diagnostics {
				codes = append(codes, d.Code())
			}
			if len(codes) != 1 || codes[0] != 1170 {
				t.Fatalf("native TypeScript reports only TS1170; got %s", fmt.Sprint(codes))
			}
		})
	}
}
