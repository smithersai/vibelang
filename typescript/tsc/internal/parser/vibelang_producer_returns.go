package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// ProducerReturnValueCode: return value in a producer (VIP-21). {0} is the
// value. The checker reports it for a producer's own statements; the parser
// reports it where DoBoundaryCode would otherwise hide it.
const (
	ProducerReturnValueCode    = 2128
	ProducerReturnValueMessage = "A producer returns a Stream, which has no return value, so {0} would be dropped; write return alone to end the stream."
)

// A valued return that would leave an unsupported do position inside a
// producer breaks VIP-21's rule whatever the compiler does with that do, so it
// is EK2128 there, not the implementation-boundary EK0204. The checker reports
// the returns among a producer's own statements and cannot tell a written
// return in a retained do from the completion return its lowering adds, so
// this one is reported here. A written callable, a formal parameter, a field
// initializer, a static block and an enum keep their own return rules.
func (p *Parser) doProducerValuedReturn(jump *ast.Node) bool {
	if jump.Kind != ast.KindReturnStatement || jump.Expression() == nil {
		return false
	}
	for child, n := jump, jump.Parent; n != nil; child, n = n, n.Parent {
		switch n.Kind {
		case ast.KindParameter:
			if n.Parent != nil && ast.IsFunctionLike(n.Parent) {
				return false
			}
		case ast.KindPropertyDeclaration:
			if child == n.Initializer() {
				return false
			}
		case ast.KindClassStaticBlockDeclaration, ast.KindEnumDeclaration:
			return false
		}
		if !ast.IsFunctionLike(n) || child != n.Body() || p.isDoArrow(n) {
			continue
		}
		flags := ast.GetFunctionFlags(n)
		if n.Flags&ast.NodeFlagsVibeLangEffect == 0 || flags&ast.FunctionFlagsGenerator == 0 || flags&ast.FunctionFlagsAsync != 0 {
			return false
		}
		value := p.sourceRange(jump.Expression())
		p.doError(value, ProducerReturnValueCode, ProducerReturnValueMessage, p.sourceText[value.Pos():value.End()])
		return true
	}
	return false
}
