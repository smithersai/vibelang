package vibelangmapper

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// memberValueCall adapts a zero-argument member call without losing its
// receiver. D90 applies to Effect-valued members as well as functions;
// binding a method before adapting it preserves JavaScript's this.
func (p *projector) memberValueCall(call *ast.Node, e env) bool {
	access := call.Expression()
	if len(call.Arguments()) != 0 || call.TypeArguments() != nil || call.QuestionDotToken() != nil ||
		!ast.IsPropertyAccessExpression(access) || access.QuestionDotToken() != nil {
		return false
	}
	receiver := access.Expression()
	service := p.mayBeServiceKey(receiver) && !p.keyOwnedMember(access)
	field := p.forms.(*Resolver).isEffectTypeNode(p.dataReceiverType(access, 0), 0)
	if !service && !field {
		return false
	}
	member := access.Name().Text()
	p.plan.mark(editValueCall, partOpen, p.tokenStart(receiver), p.tokenStart(receiver), member)
	if service {
		p.plan.mark(editServiceCall, partOpen, p.tokenStart(receiver), p.tokenStart(receiver), "")
	}
	p.visit(receiver, e)
	if service {
		p.plan.mark(editServiceCall, partClose, receiver.End(), receiver.End(), "")
	}
	p.plan.mark(editValueCall, partClose, receiver.End(), access.End(), member)
	return true
}

// keyOwnedMember implements L8 from local service syntax. An external key's
// own member stays on the key; Key().member explicitly selects its service.
func (p *projector) keyOwnedMember(access *ast.Node) bool {
	if !keyMembers[access.Name().Text()] {
		return false
	}
	var service *ast.Node
	if ast.IsIdentifier(access.Expression()) {
		service = p.services[access.Expression().Text()]
	}
	if service != nil {
		for _, member := range service.Members() {
			if name, ok := formsPropertyName(member); ok && name == access.Name().Text() && !ast.IsStatic(member) {
				return false
			}
		}
	}
	return true
}

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

// keyLookupLambda makes a lambda that only looks up a pinned service an
// Effect function too. A table-proven key lookup always contributes R, even
// when its service member returns a plain value (D90).
func (p *projector) keyLookupLambda(fn *ast.Node) bool {
	found := false
	var walk func(*ast.Node) bool
	walk = func(n *ast.Node) bool {
		if n != fn && isLambda(n) {
			return false
		}
		if ast.IsCallExpression(n) {
			access := n.Expression()
			if ast.IsPropertyAccessExpression(access) && p.pinnedContextKey(access.Expression()) && !p.keyOwnedMember(access) {
				found = true
				return true
			}
		}
		return n.ForEachChild(walk)
	}
	walk(fn.Body())
	return found
}
