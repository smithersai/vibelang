package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

// The loop owns only its outer argument mismatch, including after TypeScript
// unwraps parentheses. Errors computing the operand and inside the item remain.
func TestConcurrentOperandDiagnosticPositions(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentOperandQuote) {
		t.Fatal("stale operand rule")
	}
	w := NewWorkspace(t)
	for _, item := range []struct {
		name, source string
		want         []int32
	}{
		{"object", "export effect function f(){for concurrent(const x of ({})) {}}", []int32{1901}},
		{"nested-object", "export effect function f(){for concurrent(const x of ((({})))) {}}", []int32{1901}},
		{"scalar", "export effect function f(){for concurrent(const x of ((5))) {}}", []int32{1901}},
		{"operand-error", "function make(n:number){return 5};export effect function f(){for concurrent(const x of ((make(\"bad\")))) {}}", []int32{1901, 2345}},
		{"operand-property-error", "export effect function f(){for concurrent(const x of (((()=>{const bad:{required:number}={};return 5})()))) {}}", []int32{1901, 2741}},
		{"body-property-error", "export effect function f(){for concurrent(const x of ((5))) {const bad:{required:number}={}}}", []int32{1901, 2741}},
		{"body-error", "export effect function f(){for concurrent(const x of ((5))) {const bad:number=\"bad\"}}", []int32{1901, 2322}},
	} {
		t.Run(item.name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Single(item.source))
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
			if !slices.Equal(codes, item.want) {
				t.Fatalf("got error codes %v, want %v", codes, item.want)
			}
		})
	}
}
