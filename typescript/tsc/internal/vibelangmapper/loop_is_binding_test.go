package vibelangmapper

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestLoopIsBindingProjection(t *testing.T) {
	corpus, err := os.ReadFile("../../../vibelang/cases/cov900-loop-fresh-binding.fail/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]string{
		"fresh-binding-corpus":    string(corpus),
		"condition-and-increment": "function use(n: number) {} export function fresh(it: {next(): IteratorResult<number>}) { for (; it.next() is {done: false, value: let v}; use(v)) {} }",
		"condition-and-body":      "function use(n: number) {} export function fresh(it: {next(): IteratorResult<number>}) { for (; it.next() is {done: false, value: let v};) { use(v) } }",
		"parenthesized-condition": "function use(n: number) {} export function fresh(it: {next(): IteratorResult<number>}) { for (; (it.next()) is {done: false, value: let v}; use(v)) {} }",
	} {
		t.Run(name, func(t *testing.T) {
			p := lower(source, testContext)
			if _, _, overlap, ok := p.plan.render(checking{names: p.names}, p.text, func() string { return "" }); !ok {
				for _, edit := range p.plan.edits {
					if edit.pos <= overlap+20 && edit.end >= overlap-20 {
						t.Logf("overlap edit: %+v", edit)
					}
				}
				var walk func(*ast.Node, int)
				walk = func(n *ast.Node, depth int) {
					if n.Pos() <= overlap && n.End() >= overlap && depth <= 5 {
						t.Logf("overlap ancestor depth=%d kind=%v flags=%v span=[%d,%d) source=%t match=%t", depth, n.Kind, n.Flags, n.Pos(), n.End(), p.isSource(n), p.isMatchForm(n))
						n.ForEachChild(func(child *ast.Node) bool { walk(child, depth+1); return false })
					}
				}
				walk(p.file.AsNode(), 0)
				t.Fatalf("overlapping lowering edits at %d", overlap)
			}
			for kind, projection := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
				for _, d := range projection.Diagnostics {
					if strings.Contains(d.Message, "overlapping edits") {
						t.Errorf("%s: %s", kind, d.Message)
					}
				}
				assertValidMap(t, projection, source)
				assertParses(t, projection.Text)
			}
			js, _, diagnostics := Emit(source, testContext)
			if js == "" {
				t.Fatalf("no executable output: %+v", diagnostics)
			}
			if !strings.Contains(js, "function use$direct(") {
				t.Fatalf("pure entry lost:\n%s", js)
			}
		})
	}
}
