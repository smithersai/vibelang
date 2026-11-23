package vibelangmapper

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// renderValueCall shares the D90 adapter between checking and execution.
// A member adapter receives the object and name separately to evaluate the
// receiver once and retain this, including for ordinary non-key objects.
func renderValueCall(e edit) string {
	if e.arg != "" {
		return pick(e.part, helperRef("$member")+"(", "", ", "+strconv.Quote(e.arg)+")")
	}
	return pick(e.part, helperRef("$value")+"(", "", ")")
}

// pinnedContextKey recognizes a key export by the pinned declarations, through
// lexical import aliases. Module names and capitalization cannot prove a key.
func (p *projector) pinnedContextKey(receiver *ast.Node) bool {
	r, ok := p.forms.(*Resolver)
	if !ok || r.table == nil {
		return false
	}
	root, chain, ok := formsNameChain(receiver)
	return ok && r.table.ValueModule(r.calleeOf(root, chain, 0).Canonical) == "effect/Context"
}
