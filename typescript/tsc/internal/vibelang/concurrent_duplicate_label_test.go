package vibelang

import (
	"fmt"
	"slices"
	"testing"
)

func TestConcurrentDuplicateLabel(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		duplicate  bool
	}{
		{"native-loop", "own:for(const y of [1]){continue own}", true},
		{"block", "own:{7}", true},
		{"nested-item", "for concurrent(const y of [1]){own:{7}}", true},
		{"do", "const v=do {own:{7};7};void v", true},
		{"mask", "uninterruptible{own:{7}}", true},
		{"function", "function f(){own:for(const y of [1]){continue own}}", false},
		{"arrow", "const f=()=>{own:for(const y of [1]){continue own}}", false},
		{"method", "const o={f(){own:for(const y of [1]){continue own}}}", false},
		{"effect-function", "effect function f(){own:for(const y of [1]){continue own}}", false},
		{"sibling-labels", "local:{7};local:{8}", false},
		{"different-label", "other:for(const y of [1]){continue other}", false},
	} {
		for _, limit := range []string{"", "(1)", "(2)", "(\"unbounded\")"} {
			t.Run(tc.name+limit, func(t *testing.T) {
				source := fmt.Sprintf("export effect function main(){own:for concurrent%s(const x of [1]){%s};return 7}", limit, tc.body)
				var got []int32
				for _, d := range errorsOf(t, source) {
					got = append(got, d.Code())
				}
				var want []int32
				if tc.duplicate {
					want = []int32{1114}
				}
				if !slices.Equal(got, want) {
					t.Fatalf("diagnostics %v, want %v\n%s", got, want, source)
				}
			})
		}
	}
	for _, source := range []string{
		"export effect function main(){own:alias:for concurrent(1)(const x of [1]){alias:{7}};return 7}",
	} {
		t.Run("source-homes", func(t *testing.T) {
			ds := errorsOf(t, source)
			if len(ds) != 1 || ds[0].Code() != 1114 {
				t.Fatalf("want TS1114, got %v\n%s", ds, source)
			}
		})
	}
}
