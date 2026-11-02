package parser

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A do lowering writes temporaries and their references with ranges taken
// from the source; none may end before it starts. One did on vibe
// e9e851fdf6b6 (a match whose arms are [] and a do ending in an array), and
// a check reading its text panicked: slice bounds out of range.
func TestDoLoweringRangesNeverInvert(t *testing.T) {
	for _, source := range []string{
		"const f = (o: Option.Option<string>): ReadonlyArray<string> => match (o) {\n  when Option.None: [];\n  when Option.Some(let s): do { const t = s; [t] };\n}\n",
		"const g = (o: Option.Option<string>) => ({ before: [], after: match (o) {\n  when Option.None: [];\n  when Option.Some(let s): do { const t = s; [t] };\n} })\n",
		"const h = (flag: boolean): ReadonlyArray<string> => do {\n  if (flag) { [] } else { (do { ['x'] }) }\n}\n",
		// The last arm without its ; (EK0701): recovery once gave the do
		// temporary a range that ended before it started.
		"const m = (n: 0 | 1) => { const items = match (n) { when 0: []; when 1: do { const y = 'y'; [y] } }\n  return items\n}\n",
		"const k = (n: 0 | 1) => [ 'head', ...match (n) { when 0: []; when 1: do { const a = 'x'; [a] }; } ]\n",
	} {
		file := ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Pos() > node.End() {
				t.Errorf("%v at [%d, %d) ends before it starts in\n%s", node.Kind, node.Pos(), node.End(), source)
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
}
