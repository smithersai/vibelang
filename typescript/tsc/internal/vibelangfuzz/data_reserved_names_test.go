package vibelangfuzz

import (
	"fmt"
	"testing"
)

// Chapter 006: "a variant field named `_tag`; rename it, because the variant name supplies
// the tag" is EK1601, and "a variant named `$is` or `$match`, generic data included" is
// EK1602. Neither reports the compatibility code it replaced, nor TypeScript's TS2344 at
// the generated type argument.
func TestDataReservedNames(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source string
		want   int32
	}{
		{"data D { A { readonly _tag: string } }", 1601},
		{"data D { A { readonly \"_tag\": string } }", 1601},
		{"data D { A { readonly \\u005ftag: string } }", 1601},
		{"data D { A; B { readonly x: number; readonly _tag: 1 } }", 1601},
		{"data D<T> { A { readonly _tag: T } }", 1601},
		{"data D { $is }", 1602},
		{"data D { $match }", 1602},
		{"data D { $is { readonly x: number } }", 1602},
		{"data D<T> { $match { readonly value: T } }", 1602},
	} {
		t.Run(c.source, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": "export " + c.source + "\n"}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []int32
			for _, d := range r.Diagnostics {
				codes = append(codes, d.Code())
			}
			if len(codes) != 1 || codes[0] != c.want {
				t.Fatalf("%s: want only EK%d, got %s", c.source, c.want, fmt.Sprint(codes))
			}
		})
	}
}
