package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-7's ordered property observations retain the original checking scope.
// Cache wrappers must contain their predicate and the source references it
// holds; internal cache names must never become user diagnostics.
func FuzzPatternCacheNativeScopes(f *testing.F) {
	startShortBudget(f)
	f.Add("binding")
	f.Add("discriminant")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !strings.Contains(SpecText("004-match.md"), patternCacheProjectionQuote) {
			t.Fatal("cached-pattern authority changed")
		}
		var mode uint64
		for i := 0; i < len(key) && i < 16; i++ {
			mode = mode*131 + uint64(key[i])
		}
		source := "export function f(s: unknown) { return (s is { value: let value }) ? value : 0 }"
		if key == "discriminant" || key != "binding" && mode&1 != 0 {
			source = "export function f(s: {_tag: \"leaf\"} | {_tag: \"node\"; value: number}): number { if (s is {_tag: \"leaf\"}) return 0; return s.value }"
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "s is", "(s) is")
		}
		source = strings.Repeat("\n", int(mode%5)) + strings.Repeat(" ", int(mode%13)) + source
		c, err := w.CompileOrdered(t.Context(), Single(source), OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		for _, d := range c.Diagnostics {
			if name := compilerTemporaryName.FindString(doTemporaryDiagnosticText(d)); name != "" {
				t.Fatalf("%s leaked %s: %s", key, name, d)
			}
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s valid predicate: %s", key, d)
			}
		}
		file := c.SourceFile("main.vibe")
		if file == nil {
			t.Fatal("missing main source")
		}
		contains := func(outer, inner *ast.Node) bool { return outer.Pos() <= inner.Pos() && outer.End() >= inner.End() }
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsArrowFunction(n) && ast.IsBlock(n.Body()) && len(parser.VibeLangMatchCacheBindings(n.Body())) != 0 {
				for _, parameter := range n.Parameters() {
					if parameter.Pos() >= n.Body().Pos() && parameter.End() <= n.Body().End() {
						t.Errorf("%s predicate parameter %v is inside cache body %v", key, parameter.Loc, n.Body().Loc)
					}
				}
			}
			if parser.VibeLangMatchCacheCondition(n) != nil {
				var written func(*ast.Node) bool
				written = func(child *ast.Node) bool {
					if ast.IsIdentifier(child) && child.Flags&ast.NodeFlagsReparsed == 0 && !contains(n, child) {
						t.Errorf("%s cache condition %v excludes source %q at %v", key, n.Loc, child.Text(), child.Loc)
					}
					return child.ForEachChild(written)
				}
				n.ForEachChild(written)
			}
			if ast.IsBlock(n) && len(parser.VibeLangMatchCacheBindings(n)) != 0 {
				for _, statement := range n.Statements() {
					if ast.IsReturnStatement(statement) && statement.Expression() != nil && !contains(statement, statement.Expression()) {
						t.Errorf("%s cached return %v excludes predicate %v", key, statement.Loc, statement.Expression().Loc)
					}
				}
			}
			return n.ForEachChild(visit)
		}
		visit(file.AsNode())
	})
}
