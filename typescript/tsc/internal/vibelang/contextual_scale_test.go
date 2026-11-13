package vibelang

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Each test owns its nodes and counter. Other parallel checkers do not
// contribute, and hook registration happens only during package initialization.
var contextualLookupCounters sync.Map

func init() {
	checker.RegisterContextualReturnTypeHook(func(_ *checker.Checker, fn *ast.Node, result *checker.Type, _ func() *checker.Type) *checker.Type {
		if counter, ok := contextualLookupCounters.Load(fn); ok {
			counter.(*atomic.Uint64).Add(1)
		}
		return result
	})
}

func TestNestedArrowContextualLookup(t *testing.T) {
	// Repeating an uncached contextual signature query used to multiply the
	// work at each nesting level. Contextual typing visits enclosing arrows,
	// so quadratic work is expected; repeating the fallback made it exponential.
	// Count queries instead of timing a busy builder.
	for _, depth := range []int{10, 25, 50, 100, 200} {
		t.Run(fmt.Sprint(depth), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export const f = "+strings.Repeat("() => ", depth)+"1\n")
			var queries atomic.Uint64
			nodes := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsArrowFunction(n) {
					nodes++
					contextualLookupCounters.Store(n, &queries)
					t.Cleanup(func() { contextualLookupCounters.Delete(n) })
				}
				n.ForEachChild(visit)
				return false
			}
			visit(file.AsNode())
			if nodes != depth {
				t.Fatalf("found %d arrows, want %d", nodes, depth)
			}
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			count := queries.Load()
			t.Logf("depth %d: %d contextual return queries", depth, count)
			limit := uint64(depth * (depth + 3))
			if count < uint64(depth) || count > limit {
				t.Fatalf("%d arrows performed %d contextual return queries; want between %d and %d", depth, count, depth, limit)
			}
		})
	}
}
