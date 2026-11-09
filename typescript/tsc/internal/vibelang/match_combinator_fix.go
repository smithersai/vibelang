package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The explicit default must retain the old implicit TypeError, including its
// defect channel in effect code. An open match of void 0 against 0 cannot
// succeed; its never-valued arm contributes no result or error type. This
// uses the existing match fallback, independently of source globals, imports
// and shadowed TypeError/Effect bindings. No original pattern is re-evaluated.
const matchCombinatorFallback = " default: match (void 0 as unknown) { when 0: (void 0 as never); }; "

// Parse patterns instead of searching their text: strings, property names and
// guard expressions may contain the contextual words and/not as ordinary data.
func matchPatternNeedsCombinatorFallback(pattern string) bool {
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/coverage.vibe", PathKey: "/coverage.vibe"}, "match (value) { when "+pattern+": 0; default: 0; }")
	var marked func(*ast.Node) bool
	marked = func(n *ast.Node) bool {
		return n.Flags&ast.NodeFlagsVibeLangUncountedPattern != 0 || n.ForEachChild(marked)
	}
	return marked(file.AsNode())
}
