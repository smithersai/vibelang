package vibelang

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// flowNarrowings counts the narrowings flow analysis asks of the hooks
// registered after VibeLang's own, that is, those VibeLang's hooks leave to
// TypeScript.
var flowNarrowings atomic.Int64

func init() {
	checker.RegisterFlowNarrowingHook(func(*checker.Checker, *ast.Node, *checker.Type, *ast.Node, bool, func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
		flowNarrowings.Add(1)
		return nil
	})
}

// variantsSource is a data type of n variants and a function that tests a
// value of it against each: an exhaustive match or a chain of is tests.
func variantsSource(form string, n int) string {
	var b strings.Builder
	b.WriteString("data Big {\n")
	for i := range n {
		fmt.Fprintf(&b, "  V%d { x: number }\n", i)
	}
	b.WriteString("}\nexport function f(b: Big): number {\n")
	if form == "match" {
		b.WriteString("  return match (b) {\n")
		for i := range n {
			fmt.Fprintf(&b, "    when Big.V%d { let x }: x + %d;\n", i, i)
		}
		b.WriteString("  }\n")
	} else {
		for i := range n {
			fmt.Fprintf(&b, "  if (b is Big.V%d) return %d\n", i, i)
		}
		b.WriteString("  return -1\n")
	}
	b.WriteString("}\n")
	return b.String()
}

// literalsSource is a union of n string literals and an exhaustive match of it.
func literalsSource(n int) string {
	var b strings.Builder
	b.WriteString("type Shape = \"V0\"")
	for i := 1; i < n; i++ {
		fmt.Fprintf(&b, " | \"V%d\"", i)
	}
	b.WriteString("\nexport function f(s: Shape): number {\n  return match (s) {\n")
	for i := range n {
		fmt.Fprintf(&b, "    when \"V%d\": %d;\n", i, i)
	}
	b.WriteString("  }\n}\n")
	return b.String()
}

// checkSource checks source and returns the allocations, the bytes and the
// narrowings it took. All are counts of work, not times, so a loaded machine
// does not change them.
func checkSource(t *testing.T, source string) (allocations, bytes, narrowings int64) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	flowNarrowings.Store(0)
	diagnostics := program.GetSemanticDiagnostics(context.Background(), file)
	narrowings = flowNarrowings.Load()
	runtime.ReadMemStats(&after)
	for _, d := range diagnostics {
		t.Errorf("unexpected diagnostic %s", d.String())
	}
	return int64(after.Mallocs - before.Mallocs), int64(after.TotalAlloc - before.TotalAlloc), narrowings
}

// checkVariants checks variantsSource(form, n) and returns the allocations
// and the narrowings it took.
func checkVariants(t *testing.T, form string, n int) (allocations, narrowings int64) {
	t.Helper()
	allocations, _, narrowings = checkSource(t, variantsSource(form, n))
	return allocations, narrowings
}

// A match or is chain over a data type of n variants narrows each reference
// to the subject through the arms before it: n references times n arms. The
// work must stay quadratic. It was cubic, and a match of 250 variants ran out
// of memory: each narrowing printed each variant's _tag type to compare it,
// and typed each arm's matcher, Big.V0, anew through the arms before it.
// Quadrupling n multiplies quadratic work by 16 and cubic work by 64.
func TestVariantPatternsScaleQuadratically(t *testing.T) {
	const small, large, limit = 40, 160, 32
	for _, form := range []string{"match", "is"} {
		smallAllocations, smallNarrowings := checkVariants(t, form, small)
		largeAllocations, largeNarrowings := checkVariants(t, form, large)
		t.Logf("%s: n=%d allocations=%d narrowings=%d; n=%d allocations=%d narrowings=%d", form, small, smallAllocations, smallNarrowings, large, largeAllocations, largeNarrowings)
		if ratio := largeAllocations / smallAllocations; largeAllocations >= limit*smallAllocations {
			t.Errorf("%s: %d variants allocate %d times as much as %d (%d, %d); want under %d", form, large, ratio, small, largeAllocations, smallAllocations, limit)
		}
		if ratio := largeNarrowings / smallNarrowings; largeNarrowings >= limit*smallNarrowings {
			t.Errorf("%s: %d variants narrow %d times as often as %d (%d, %d); want under %d", form, large, ratio, small, largeNarrowings, smallNarrowings, limit)
		}
	}
}

// A match over n string literals removes a literal from the subject's union
// n times n over 2 times. A removal must not cost the union's size each time:
// that made 2000 arms take 95 s of CPU, and match-flow-limit.fail went RED on
// a busy host against the harness's 120 s limit.
func TestLiteralPatternNarrowingAllocations(t *testing.T) {
	const arms, limit = 500, 1024
	_, bytes, narrowings := checkSource(t, literalsSource(arms))
	t.Logf("%d arms: %d bytes over %d narrowings", arms, bytes, narrowings)
	if narrowings == 0 || bytes >= limit*narrowings {
		t.Errorf("%d arms allocate %d bytes over %d narrowings; want under %d bytes each", arms, bytes, narrowings, limit)
	}
}

// Exercise the exact budget boundary without allocating millions of union
// members. The scaling test above covers the real checker path.
func TestVariantPatternWorkLimit(t *testing.T) {
	program, file, _, _ := editorProgram(t, "function f() { return 0 }\nfunction g() { return 1 }")
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	if diagnostics := c.GetDiagnostics(t.Context(), file); len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", diagnostics)
	}
	f, g := file.Statements.Nodes[0], file.Statements.Nodes[1]
	state := tagNarrowingsFor(c)
	state.work[f] = maxTagNarrowingWork - 3
	union := c.GetUnionType([]*checker.Type{c.GetStringLiteralType("a"), c.GetStringLiteralType("b"), c.GetStringLiteralType("c")})
	value := c.GetAnyType()
	if got := narrowByTag(c, f.Name(), union, "A", value, false); got != union {
		t.Fatal("narrowing at the budget boundary failed")
	}
	if got := narrowByTag(c, f.Name(), union, "A", value, false); got != union || state.work[f] != maxTagNarrowingWork {
		t.Fatal("cached narrowing consumed budget")
	}
	for _, tag := range []string{"B", "C"} {
		if got := narrowByTag(c, f.Name(), union, tag, value, false); got != c.GetErrorType() {
			t.Fatal("exhausted narrowing did not return an error type")
		}
	}
	if got := narrowByTag(c, g.Name(), union, "D", value, false); got != union || state.work[g] != 3 {
		t.Fatal("one function exhausted another function's budget")
	}
	if len(state.types) != 2 {
		t.Fatalf("exhausted narrowings were cached: %d entries", len(state.types))
	}
	diagnostics := c.GetDiagnostics(t.Context(), file)
	if len(diagnostics) != 1 || diagnostics[0].Code() != 2563 {
		t.Fatalf("want one TS2563 after budget exhaustion, got %v", diagnostics)
	}
}
