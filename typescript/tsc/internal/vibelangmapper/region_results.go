package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// normalizeRegionResults preserves the source's normal-completion type.
// A syntactically non-completing try with no
// outgoing jumps returns its never-valued region, so an enclosing generator
// cannot invent a void success path after it.
func (p *projector) normalizeRegionResults() {
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		if n.Kind == ast.KindTryStatement {
			// Retired handler syntax has already been removed by the plan.
			// Do not add completion witnesses inside that rejected source range.
			if n.Flags&ast.NodeFlagsVibeLang != 0 {
				return
			}
			if !completes(n) {
				for i, edit := range p.plan.edits {
					if edit.kind == editRegion && edit.part == partOpen && edit.pos == p.tokenStart(n) && strings.HasPrefix(edit.text, "yield* ") {
						p.plan.edits[i].text = "return " + edit.text
					}
				}
			}
		}
		n.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	}
	visit(p.file.AsNode())
}
