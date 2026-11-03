package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

// EK1907 owns the limit's assignment error. It must not hide an independent
// argument error or unresolved name while computing that limit.
func TestConcurrentLimitOperandErrors(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentLimitDomainQuote)
	w := NewWorkspace(t)
	for _, item := range []struct {
		name, arg string
		want      int32
	}{
		{"argument", "\"bad\"", 2345},
		{"name", "missing", 2304},
	} {
		t.Run(item.name, func(t *testing.T) {
			source := "function choose(n:number){return true} export effect function main(){for concurrent((choose(" + item.arg + "))) (const x of [1]){} }"
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []int32
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			slices.Sort(codes)
			want := []int32{1907, item.want}
			slices.Sort(want)
			if !slices.Equal(codes, want) {
				t.Fatalf("limit diagnostic must preserve its operand error: got %v, want %v", codes, want)
			}
		})
	}
}
